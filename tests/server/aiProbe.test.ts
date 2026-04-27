import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  _resetAiProbeCacheForTests,
  runAiProbe
} from "../../server/ai/aiProbe";
import {
  type AiProbeResult,
  getActiveAiResumeProvider
} from "../../server/ai/aiProvider";
import {
  getServerConfig,
  hydrateEnvFromFile
} from "../../server/config/env";

const ENV_KEYS = [
  "AI_PROVIDER",
  "OPENAI_API_KEY",
  "OPENAI_RESUME_MODEL",
  "AZURE_OPENAI_API_KEY",
  "AZURE_OPENAI_ENDPOINT",
  "AZURE_OPENAI_RESUME_DEPLOYMENT"
] as const;
const SAVED: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

beforeEach(() => {
  hydrateEnvFromFile();
  _resetAiProbeCacheForTests();
  for (const key of ENV_KEYS) {
    SAVED[key] = process.env[key];
    delete process.env[key];
  }
});
afterEach(() => {
  _resetAiProbeCacheForTests();
  for (const key of ENV_KEYS) {
    if (SAVED[key] === undefined) delete process.env[key];
    else process.env[key] = SAVED[key];
  }
});

describe("runAiProbe — caching", () => {
  it("returns cached=false on the first call and cached=true on the second within TTL", async () => {
    const first = await runAiProbe();
    expect(first.cached).toBe(false);
    expect(first.result.provider).toBe("deterministic");
    const second = await runAiProbe();
    expect(second.cached).toBe(true);
    expect(second.result.observedAt).toBe(first.result.observedAt);
  });

  it("force=true bypasses the cache and re-runs the probe", async () => {
    const first = await runAiProbe();
    expect(first.cached).toBe(false);
    const second = await runAiProbe({ force: true });
    expect(second.cached).toBe(false);
  });

  it("re-keys when the configured provider/model changes", async () => {
    const first = await runAiProbe();
    expect(first.result.provider).toBe("deterministic");
    expect(first.cached).toBe(false);
    // Change config so the cache key changes — should re-probe.
    process.env.OPENAI_API_KEY = "sk-test-12345";
    process.env.OPENAI_RESUME_MODEL = "gpt-4.1-mini";
    const second = await runAiProbe();
    expect(second.cached).toBe(false);
    expect(second.result.provider).toBe("openai");
  });
});

describe("AiResumeProvider.probe — deterministic", () => {
  it("returns ok=true with 0ms latency", async () => {
    const { primary } = getActiveAiResumeProvider(getServerConfig());
    expect(primary.id).toBe("deterministic");
    const result = await primary.probe();
    expect(result.ok).toBe(true);
    expect(result.latencyMs).toBe(0);
    expect(result.observedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe("AiResumeProvider.probe — openai (no real network)", () => {
  it("categorises an unconfigured key as not_configured WITHOUT making a network call", async () => {
    process.env.OPENAI_API_KEY = "";
    process.env.AI_PROVIDER = "openai";
    // The provider only sees an empty key → not_configured branch.
    const { primary } = getActiveAiResumeProvider(getServerConfig());
    // Provider id will resolve to deterministic without a key, so
    // the not_configured assertion would happen INSIDE the openai
    // probe path. To exercise that path we must construct the
    // openai provider directly with an empty key.
    const { createOpenAiResumeProvider } = await import(
      "../../server/ai/openAiProvider"
    );
    const openai = createOpenAiResumeProvider({
      apiPort: 0,
      webOrigin: "",
      aiProvider: "openai",
      openai: { apiKey: "", resumeModel: "gpt-4.1-mini", jobModel: "gpt-4.1-mini" },
      azureOpenai: {
        endpoint: "",
        apiKey: "",
        apiVersion: "",
        resumeDeployment: "",
        jobDeployment: ""
      }
    });
    const result: AiProbeResult = await openai.probe();
    expect(result.ok).toBe(false);
    expect(result.errorCategory).toBe("not_configured");
    // Deterministic primary case — silenced lint by referencing.
    void primary;
  });
});
