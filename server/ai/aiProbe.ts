import {
  type AiProbeResult,
  getActiveAiResumeProvider
} from "./aiProvider";
import type { ServerConfig } from "../config/env";
import { getServerConfig } from "../config/env";

/**
 * Cached LLM round-trip probe.
 *
 * The orchestrator wraps each provider's `probe()` with an in-
 * memory TTL cache so the Admin page (or a chatty health check)
 * can poll without spamming OpenAI. The cache is keyed by the
 * tuple `(provider, model)` — when an operator changes either
 * via env, the next probe re-runs immediately.
 *
 * The `force: true` option bypasses the cache; the route exposes
 * it via `?force=1` so an operator can confirm a fix landed
 * without waiting for the TTL.
 */

const PROBE_TTL_MS = 60_000;

interface CachedEntry {
  key: string;
  result: AiProbeResult;
  expiresAt: number;
}

let cachedEntry: CachedEntry | null = null;

function buildCacheKey(config: ServerConfig): string {
  if (config.aiProvider === "openai") {
    return `openai:${config.openai.resumeModel}`;
  }
  if (config.aiProvider === "azure_openai") {
    return `azure_openai:${config.azureOpenai.endpoint}:${config.azureOpenai.resumeDeployment}:${config.azureOpenai.apiVersion}`;
  }
  return `deterministic:local`;
}

export interface RunAiProbeOptions {
  /** Bypass the cache and re-issue the probe. */
  force?: boolean;
  /** Inject a server config for tests. */
  config?: ServerConfig;
  /** Override TTL for tests (ms). Defaults to 60_000. */
  ttlMs?: number;
}

export interface AiProbeOrchestratorResult {
  result: AiProbeResult;
  /** True when this call hit the cache instead of issuing a probe. */
  cached: boolean;
  /** Wall-clock ms remaining until cache expiry (negative when fresh). */
  staleAfterMs: number;
}

export async function runAiProbe(
  options: RunAiProbeOptions = {}
): Promise<AiProbeOrchestratorResult> {
  const config = options.config ?? getServerConfig();
  const ttlMs = options.ttlMs ?? PROBE_TTL_MS;
  const key = buildCacheKey(config);

  if (
    !options.force &&
    cachedEntry &&
    cachedEntry.key === key &&
    cachedEntry.expiresAt > Date.now()
  ) {
    return {
      result: cachedEntry.result,
      cached: true,
      staleAfterMs: cachedEntry.expiresAt - Date.now()
    };
  }

  const { primary } = getActiveAiResumeProvider(config);
  const result = await primary.probe();
  cachedEntry = {
    key,
    result,
    expiresAt: Date.now() + ttlMs
  };
  return {
    result,
    cached: false,
    staleAfterMs: ttlMs
  };
}

/**
 * Test seam — clears the cache so unit tests start from a known
 * state. Not exposed to the route layer.
 */
export function _resetAiProbeCacheForTests(): void {
  cachedEntry = null;
}
