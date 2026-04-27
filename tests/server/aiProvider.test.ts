import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getActiveAiResumeProvider } from "../../server/ai/aiProvider";
import { getServerConfig, hydrateEnvFromFile } from "../../server/config/env";

const ENV_KEYS = [
  "AI_PROVIDER",
  "OPENAI_API_KEY",
  "AZURE_OPENAI_API_KEY",
  "AZURE_OPENAI_ENDPOINT",
  "AZURE_OPENAI_RESUME_DEPLOYMENT",
  "AZURE_OPENAI_API_VERSION"
] as const;

const SAVED: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

beforeEach(() => {
  // Trip the one-shot `envHydrated` flag under test control before
  // we clear env vars; otherwise the user's local .env would
  // re-leak into process.env on the first getServerConfig call.
  hydrateEnvFromFile();
  for (const key of ENV_KEYS) {
    SAVED[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (SAVED[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = SAVED[key];
    }
  }
});

describe("getActiveAiResumeProvider", () => {
  it("returns deterministic primary + deterministic fallback when nothing is configured", () => {
    const { primary, fallback } = getActiveAiResumeProvider(getServerConfig());
    expect(primary.id).toBe("deterministic");
    expect(fallback.id).toBe("deterministic");
  });

  it("returns openai primary + deterministic fallback when OPENAI_API_KEY is set", () => {
    process.env.OPENAI_API_KEY = "sk-test-12345";
    const { primary, fallback } = getActiveAiResumeProvider(getServerConfig());
    expect(primary.id).toBe("openai");
    expect(fallback.id).toBe("deterministic");
  });

  it("returns azure_openai primary when only Azure is configured", () => {
    process.env.AZURE_OPENAI_API_KEY = "azure-key";
    process.env.AZURE_OPENAI_ENDPOINT = "https://example.openai.azure.com";
    process.env.AZURE_OPENAI_RESUME_DEPLOYMENT = "deploy-1";
    const { primary, fallback } = getActiveAiResumeProvider(getServerConfig());
    expect(primary.id).toBe("azure_openai");
    expect(fallback.id).toBe("deterministic");
  });

  it("respects AI_PROVIDER=deterministic even when OPENAI_API_KEY is set", () => {
    process.env.AI_PROVIDER = "deterministic";
    process.env.OPENAI_API_KEY = "sk-test-12345";
    const { primary } = getActiveAiResumeProvider(getServerConfig());
    expect(primary.id).toBe("deterministic");
  });
});

describe("deterministic provider analyzeResume", () => {
  it("returns the canonical adapter shape with extractionMode=deterministic", async () => {
    const { primary } = getActiveAiResumeProvider(getServerConfig());
    const result = await primary.analyzeResume({
      resumeId: "resume_test",
      resumeText: `Jane Doe
Senior Product Manager
jane@example.com
+1 555-555-0100

Experience
Senior Product Manager — DemoLabs — 2022 - 2026
Led B2B SaaS workflow automation roadmap; +20% activation.

Skills
Product Management, Roadmap`
    });
    expect(result.provider).toBe("deterministic");
    expect(result.fallbackUsed).toBe(false);
    expect(result.output.extractionMode).toBe("deterministic");
    expect(result.output.provider).toBe("deterministic");
  });
});
