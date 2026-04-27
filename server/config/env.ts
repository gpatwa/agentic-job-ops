import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Tiny .env loader for the server. We deliberately avoid the
 * `dotenv` dependency — the parser is small and the surface area is
 * well-scoped to this module. Variables already present in
 * `process.env` win, so a CI runner or Azure App Service can
 * override `.env` defaults without ceremony.
 *
 * Safety contract:
 * - This module never logs values from .env.
 * - The exported `getServerConfig()` returns a typed snapshot but
 *   does NOT include the raw API keys in any structure that would
 *   serialise out (see `getAiStatusSnapshot()` for the
 *   intentionally-redacted public view).
 */

export type AiProviderId = "openai" | "azure_openai" | "deterministic";

export interface ServerConfig {
  apiPort: number;
  webOrigin: string;
  aiProvider: AiProviderId;
  openai: {
    apiKey: string;
    resumeModel: string;
    jobModel: string;
  };
  azureOpenai: {
    endpoint: string;
    apiKey: string;
    apiVersion: string;
    resumeDeployment: string;
    jobDeployment: string;
  };
}

const ENV_FILES = [".env.local", ".env"] as const;

function parseDotenvLine(line: string): [string, string] | null {
  const trimmed = line.trim();
  if (trimmed.length === 0 || trimmed.startsWith("#")) return null;
  const equalsIndex = trimmed.indexOf("=");
  if (equalsIndex < 0) return null;
  const key = trimmed.slice(0, equalsIndex).trim();
  let value = trimmed.slice(equalsIndex + 1).trim();
  // Strip a single layer of surrounding quotes, mirroring dotenv.
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  return [key, value];
}

let envHydrated = false;

/**
 * Load .env files into process.env once. Existing process.env entries
 * are not overwritten — they take precedence so production runtime
 * secrets always win over local files.
 */
export function hydrateEnvFromFile(rootDir: string = process.cwd()): void {
  if (envHydrated) return;
  envHydrated = true;
  for (const fileName of ENV_FILES) {
    const filePath = resolve(rootDir, fileName);
    if (!existsSync(filePath)) continue;
    const contents = readFileSync(filePath, "utf-8");
    for (const line of contents.split(/\r?\n/)) {
      const parsed = parseDotenvLine(line);
      if (!parsed) continue;
      const [key, value] = parsed;
      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  }
}

function readEnv(name: string, fallback = ""): string {
  const raw = process.env[name];
  return typeof raw === "string" ? raw.trim() : fallback;
}

function readEnvInt(name: string, fallback: number): number {
  const raw = readEnv(name);
  if (raw.length === 0) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Pick the AI provider based on env. Honours an explicit
 * `AI_PROVIDER` override; otherwise picks the first one with the
 * required credentials present, falling back to deterministic.
 *
 * Never throws — invalid configuration degrades to deterministic so
 * the server always boots.
 */
export function resolveAiProvider(): AiProviderId {
  const explicit = readEnv("AI_PROVIDER").toLowerCase();
  if (explicit === "openai") {
    return readEnv("OPENAI_API_KEY").length > 0 ? "openai" : "deterministic";
  }
  if (explicit === "azure_openai" || explicit === "azure-openai") {
    const ready =
      readEnv("AZURE_OPENAI_API_KEY").length > 0 &&
      readEnv("AZURE_OPENAI_ENDPOINT").length > 0 &&
      readEnv("AZURE_OPENAI_RESUME_DEPLOYMENT").length > 0;
    return ready ? "azure_openai" : "deterministic";
  }
  if (explicit === "deterministic") {
    return "deterministic";
  }
  // No explicit provider — auto-detect. OpenAI takes precedence over
  // Azure OpenAI when both are configured because the OpenAI public
  // API is the simpler/local-first path.
  if (readEnv("OPENAI_API_KEY").length > 0) return "openai";
  if (
    readEnv("AZURE_OPENAI_API_KEY").length > 0 &&
    readEnv("AZURE_OPENAI_ENDPOINT").length > 0 &&
    readEnv("AZURE_OPENAI_RESUME_DEPLOYMENT").length > 0
  ) {
    return "azure_openai";
  }
  return "deterministic";
}

/**
 * Snapshot of the active server config. Safe to hand around inside
 * the server process — it carries the raw API keys and must NEVER
 * be serialised to a response or log line. Use
 * `getAiStatusSnapshot()` for the public/observable view instead.
 */
export function getServerConfig(): ServerConfig {
  hydrateEnvFromFile();
  return {
    apiPort: readEnvInt("API_PORT", 8787),
    webOrigin: readEnv("WEB_ORIGIN", "http://localhost:5173"),
    aiProvider: resolveAiProvider(),
    openai: {
      apiKey: readEnv("OPENAI_API_KEY"),
      resumeModel: readEnv("OPENAI_RESUME_MODEL", "gpt-4.1-mini"),
      jobModel: readEnv("OPENAI_JOB_MODEL", "gpt-4.1-mini")
    },
    azureOpenai: {
      endpoint: readEnv("AZURE_OPENAI_ENDPOINT"),
      apiKey: readEnv("AZURE_OPENAI_API_KEY"),
      apiVersion: readEnv("AZURE_OPENAI_API_VERSION", "2024-08-01-preview"),
      resumeDeployment: readEnv("AZURE_OPENAI_RESUME_DEPLOYMENT"),
      jobDeployment: readEnv("AZURE_OPENAI_JOB_DEPLOYMENT")
    }
  };
}

/**
 * Public, redacted snapshot of the AI configuration. Safe to return
 * from /api/ai/status. Never includes raw API keys, endpoint hosts
 * (which can be secret in some Azure setups), or deployment IDs that
 * weren't explicitly configured.
 */
export interface AiStatusSnapshot {
  provider: AiProviderId;
  configured: boolean;
  fallbackAvailable: true;
  resumeModel: string;
  jobModel: string;
  // Always true — clients use this to know they SHOULD verify the
  // source badge in the UI rather than assume a particular provider.
  requiresClientFallback: boolean;
}

export function getAiStatusSnapshot(config: ServerConfig = getServerConfig()): AiStatusSnapshot {
  if (config.aiProvider === "openai") {
    return {
      provider: "openai",
      configured: config.openai.apiKey.length > 0,
      fallbackAvailable: true,
      resumeModel: config.openai.resumeModel,
      jobModel: config.openai.jobModel,
      requiresClientFallback: true
    };
  }
  if (config.aiProvider === "azure_openai") {
    return {
      provider: "azure_openai",
      configured:
        config.azureOpenai.apiKey.length > 0 &&
        config.azureOpenai.endpoint.length > 0 &&
        config.azureOpenai.resumeDeployment.length > 0,
      fallbackAvailable: true,
      // Azure deployments map to underlying models the Azure tenant
      // controls — surface the deployment name as the public model
      // identifier so the UI can label it accurately without
      // exposing the model class.
      resumeModel: config.azureOpenai.resumeDeployment || "(not configured)",
      jobModel: config.azureOpenai.jobDeployment || "(not configured)",
      requiresClientFallback: true
    };
  }
  return {
    provider: "deterministic",
    configured: true,
    fallbackAvailable: true,
    resumeModel: "deterministic-resume-intelligence-fallback",
    jobModel: "deterministic-job-intelligence-fallback",
    requiresClientFallback: true
  };
}
