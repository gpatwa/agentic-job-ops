import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { _resetAiProbeCacheForTests } from "../../server/ai/aiProbe";
import { handleAiProbe } from "../../server/routes/aiProbeRoute";
import { hydrateEnvFromFile } from "../../server/config/env";

const ENV_KEYS = ["OPENAI_API_KEY", "AI_PROVIDER"] as const;
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

describe("GET /api/ai/probe", () => {
  it("returns 200 with the deterministic ok=true snapshot when no LLM is configured", async () => {
    const result = await handleAiProbe();
    expect(result.status).toBe(200);
    expect(result.body.ok).toBe(true);
    expect(result.body.provider).toBe("deterministic");
    expect(result.body.cached).toBe(false);
  });

  it("the second call hits the server-side cache (cached=true)", async () => {
    await handleAiProbe();
    const second = await handleAiProbe();
    expect(second.body.cached).toBe(true);
  });

  it("force=true skips the cache", async () => {
    await handleAiProbe();
    const fresh = await handleAiProbe({ force: true });
    expect(fresh.body.cached).toBe(false);
  });

  it("never includes API keys or sk- prefixes in the response body", async () => {
    process.env.OPENAI_API_KEY = "sk-DO-NOT-LEAK-12345";
    const result = await handleAiProbe({ force: true });
    const serialised = JSON.stringify(result.body);
    expect(serialised).not.toContain("sk-DO-NOT-LEAK");
    expect(serialised).not.toContain("DO-NOT-LEAK");
  });
});
