import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getAiStatusSnapshot,
  getServerConfig,
  hydrateEnvFromFile,
  resolveAiProvider
} from "../../server/config/env";

const ENV_KEYS = [
  "AI_PROVIDER",
  "OPENAI_API_KEY",
  "OPENAI_RESUME_MODEL",
  "OPENAI_JOB_MODEL",
  "AZURE_OPENAI_API_KEY",
  "AZURE_OPENAI_ENDPOINT",
  "AZURE_OPENAI_API_VERSION",
  "AZURE_OPENAI_RESUME_DEPLOYMENT",
  "AZURE_OPENAI_JOB_DEPLOYMENT",
  "API_PORT",
  "WEB_ORIGIN"
] as const;

const SAVED: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

beforeEach(() => {
  // Hydrate first so the global one-shot `envHydrated` flag in
  // env.ts trips here (under test control) instead of inside the
  // first getServerConfig call below — otherwise the user's local
  // .env values would re-leak into process.env after we just
  // cleared them.
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

describe("resolveAiProvider — explicit AI_PROVIDER override", () => {
  it("picks openai when AI_PROVIDER=openai and key is set", () => {
    process.env.AI_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "sk-test-12345";
    expect(resolveAiProvider()).toBe("openai");
  });

  it("falls back to deterministic when AI_PROVIDER=openai but no key", () => {
    process.env.AI_PROVIDER = "openai";
    expect(resolveAiProvider()).toBe("deterministic");
  });

  it("picks azure_openai when AI_PROVIDER=azure_openai and all required vars are set", () => {
    process.env.AI_PROVIDER = "azure_openai";
    process.env.AZURE_OPENAI_API_KEY = "azure-key";
    process.env.AZURE_OPENAI_ENDPOINT = "https://example.openai.azure.com";
    process.env.AZURE_OPENAI_RESUME_DEPLOYMENT = "gpt-4-mini-resume";
    expect(resolveAiProvider()).toBe("azure_openai");
  });

  it("falls back to deterministic when AI_PROVIDER=azure_openai but missing endpoint", () => {
    process.env.AI_PROVIDER = "azure_openai";
    process.env.AZURE_OPENAI_API_KEY = "azure-key";
    process.env.AZURE_OPENAI_RESUME_DEPLOYMENT = "gpt-4-mini-resume";
    // no endpoint
    expect(resolveAiProvider()).toBe("deterministic");
  });

  it("respects AI_PROVIDER=deterministic regardless of other env", () => {
    process.env.AI_PROVIDER = "deterministic";
    process.env.OPENAI_API_KEY = "sk-test-12345";
    expect(resolveAiProvider()).toBe("deterministic");
  });
});

describe("resolveAiProvider — auto-detect from credentials", () => {
  it("returns deterministic with no env at all", () => {
    expect(resolveAiProvider()).toBe("deterministic");
  });

  it("prefers openai over azure when both are configured", () => {
    process.env.OPENAI_API_KEY = "sk-test-12345";
    process.env.AZURE_OPENAI_API_KEY = "azure-key";
    process.env.AZURE_OPENAI_ENDPOINT = "https://example.openai.azure.com";
    process.env.AZURE_OPENAI_RESUME_DEPLOYMENT = "gpt-4-mini-resume";
    expect(resolveAiProvider()).toBe("openai");
  });

  it("returns azure_openai when only azure is configured", () => {
    process.env.AZURE_OPENAI_API_KEY = "azure-key";
    process.env.AZURE_OPENAI_ENDPOINT = "https://example.openai.azure.com";
    process.env.AZURE_OPENAI_RESUME_DEPLOYMENT = "gpt-4-mini-resume";
    expect(resolveAiProvider()).toBe("azure_openai");
  });
});

describe("getAiStatusSnapshot — never leaks secrets", () => {
  it("returns deterministic when nothing is configured (no API key in payload)", () => {
    const status = getAiStatusSnapshot(getServerConfig());
    expect(status.provider).toBe("deterministic");
    expect(JSON.stringify(status)).not.toContain("sk-");
    expect(JSON.stringify(status)).not.toContain("api-key");
  });

  it("returns openai snapshot without the API key value", () => {
    process.env.OPENAI_API_KEY = "sk-secret-DO-NOT-LEAK-1234567890";
    process.env.OPENAI_RESUME_MODEL = "gpt-4.1-mini";
    const status = getAiStatusSnapshot(getServerConfig());
    expect(status.provider).toBe("openai");
    expect(status.configured).toBe(true);
    expect(status.resumeModel).toBe("gpt-4.1-mini");
    const serialised = JSON.stringify(status);
    expect(serialised).not.toContain("sk-secret");
    expect(serialised).not.toContain("DO-NOT-LEAK");
  });

  it("returns azure_openai snapshot with deployment as the public model identifier (no key, no endpoint)", () => {
    process.env.AZURE_OPENAI_API_KEY = "azure-secret-DO-NOT-LEAK";
    process.env.AZURE_OPENAI_ENDPOINT =
      "https://contoso-secret-host.openai.azure.com";
    process.env.AZURE_OPENAI_RESUME_DEPLOYMENT = "prod-resume-deployment";
    const status = getAiStatusSnapshot(getServerConfig());
    expect(status.provider).toBe("azure_openai");
    expect(status.resumeModel).toBe("prod-resume-deployment");
    const serialised = JSON.stringify(status);
    expect(serialised).not.toContain("azure-secret");
    expect(serialised).not.toContain("contoso-secret-host");
  });

  it("always reports fallbackAvailable=true and requiresClientFallback=true", () => {
    const status = getAiStatusSnapshot(getServerConfig());
    expect(status.fallbackAvailable).toBe(true);
    expect(status.requiresClientFallback).toBe(true);
  });
});
