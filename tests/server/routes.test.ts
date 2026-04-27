import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getAiStatusResponse } from "../../server/routes/aiStatusRoute";
import { getHealthResponse } from "../../server/routes/healthRoute";
import { hydrateEnvFromFile } from "../../server/config/env";
import {
  AiProviderError,
  type AiResumeProvider
} from "../../server/ai/aiProvider";
import { handleResumeIntelligence } from "../../server/routes/resumeIntelligenceRoute";
import type { ResumeIntelligenceProviderResult } from "../../server/ai/aiProvider";

const ENV_KEYS = [
  "OPENAI_API_KEY",
  "AZURE_OPENAI_API_KEY",
  "AZURE_OPENAI_ENDPOINT",
  "AZURE_OPENAI_RESUME_DEPLOYMENT",
  "AI_PROVIDER"
] as const;

const SAVED: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

beforeEach(() => {
  // Trip envHydrated under test control before clearing env vars
  // so the user's .env doesn't re-leak into process.env on the
  // first getServerConfig call inside a route.
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

const SAMPLE_RESUME_TEXT = `Jane Doe
Senior Product Manager
jane@example.com
+1 555-555-0100

Experience
Senior Product Manager — DemoLabs — 2022 - 2026
Led B2B SaaS workflow automation roadmap; +20% activation.

Skills
Product Management, Roadmap`;

const SECRET_RESUME_LITERAL = "TOP_SECRET_RESUME_BLOB_DO_NOT_LOG";

function makeProvider(
  id: "openai" | "azure_openai" | "deterministic",
  behavior: "ok" | "throw"
): AiResumeProvider {
  return {
    id,
    async analyzeResume(): Promise<ResumeIntelligenceProviderResult> {
      if (behavior === "throw") {
        throw new AiProviderError(
          `Mock ${id} provider failed`,
          id
        );
      }
      // Reuse the deterministic adapter's output shape via a quick
      // in-process call so the test doesn't fabricate a fake report
      // that drifts from the canonical schema.
      const { createDeterministicResumeProvider } = await import(
        "../../server/ai/deterministicProvider"
      );
      const det = createDeterministicResumeProvider();
      const result = await det.analyzeResume({
        resumeId: "resume_test",
        resumeText: SAMPLE_RESUME_TEXT
      });
      // Override BOTH the wrapper provider and the canonical
      // output's provider so the route response reflects the
      // mock provider end-to-end.
      return {
        ...result,
        provider: id,
        fallbackUsed: false,
        output: { ...result.output, provider: id }
      };
    },
    async probe() {
      // Routes tests don't exercise the probe surface — return a
      // minimally valid shape so the AiResumeProvider interface
      // is satisfied.
      return {
        ok: true,
        provider: id,
        model: "mock-model",
        latencyMs: 0,
        observedAt: new Date().toISOString()
      };
    }
  };
}

describe("GET /api/health", () => {
  it("returns 200 with no secrets in the body", () => {
    const { status, body } = getHealthResponse();
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    const serialised = JSON.stringify(body);
    expect(serialised).not.toMatch(/sk-/);
    expect(serialised).not.toMatch(/api-key/i);
    expect(serialised).not.toMatch(/authorization/i);
  });
});

describe("GET /api/ai/status", () => {
  it("never includes the API key value in the body", () => {
    process.env.OPENAI_API_KEY = "sk-DO-NOT-LEAK-1234567890";
    const { status, body } = getAiStatusResponse();
    expect(status).toBe(200);
    const serialised = JSON.stringify(body);
    expect(serialised).not.toContain("sk-DO-NOT-LEAK");
    expect(serialised).not.toContain("DO-NOT-LEAK");
    expect(body.provider).toBe("openai");
    expect(body.configured).toBe(true);
  });

  it("never includes the Azure endpoint host in the body", () => {
    process.env.AZURE_OPENAI_API_KEY = "azure-key";
    process.env.AZURE_OPENAI_ENDPOINT =
      "https://my-tenant-secret-host.openai.azure.com";
    process.env.AZURE_OPENAI_RESUME_DEPLOYMENT = "deploy-x";
    const { body } = getAiStatusResponse();
    const serialised = JSON.stringify(body);
    expect(serialised).not.toContain("my-tenant-secret-host");
    expect(serialised).not.toContain("azure-key");
  });
});

describe("POST /api/resume-intelligence — request validation", () => {
  it("rejects an empty body with 400", async () => {
    const result = await handleResumeIntelligence({}, {
      providers: {
        primary: makeProvider("deterministic", "ok"),
        fallback: makeProvider("deterministic", "ok")
      }
    });
    expect(result.status).toBe(400);
    const body = result.body as { error: string };
    expect(body.error).toBe("Invalid request body");
  });

  it("rejects too-short resumeText with 400", async () => {
    const result = await handleResumeIntelligence({
      resumeId: "r1",
      resumeText: "tiny"
    }, {
      providers: {
        primary: makeProvider("deterministic", "ok"),
        fallback: makeProvider("deterministic", "ok")
      }
    });
    expect(result.status).toBe(400);
  });

  it("accepts a valid request and returns a canonical body", async () => {
    const result = await handleResumeIntelligence(
      { resumeId: "r1", resumeText: SAMPLE_RESUME_TEXT },
      {
        providers: {
          primary: makeProvider("openai", "ok"),
          fallback: makeProvider("deterministic", "ok")
        }
      }
    );
    expect(result.status).toBe(200);
    const body = result.body as {
      provider: string;
      extractionMode: string;
      fallbackUsed: boolean;
      report: { extractionMode: string; provider: string };
    };
    expect(body.provider).toBe("openai");
    expect(body.fallbackUsed).toBe(false);
    expect(body.report.provider).toBe("openai");
  });
});

describe("POST /api/resume-intelligence — fallback behaviour", () => {
  it("falls back to deterministic when the primary provider throws", async () => {
    const result = await handleResumeIntelligence(
      { resumeId: "r1", resumeText: SAMPLE_RESUME_TEXT },
      {
        providers: {
          primary: makeProvider("openai", "throw"),
          fallback: makeProvider("deterministic", "ok")
        }
      }
    );
    expect(result.status).toBe(200);
    const body = result.body as {
      provider: string;
      fallbackUsed: boolean;
    };
    expect(body.provider).toBe("deterministic");
    expect(body.fallbackUsed).toBe(true);
    // And the log entries reflect both the primary failure and
    // the fallback success.
    const messages = result.logs.map((entry) => entry.message);
    expect(messages).toContain("resume_intelligence.primary_failed");
    expect(messages).toContain("resume_intelligence.fallback_succeeded");
  });

  it("returns 500 when both primary AND fallback are deterministic and throw", async () => {
    const result = await handleResumeIntelligence(
      { resumeId: "r1", resumeText: SAMPLE_RESUME_TEXT },
      {
        providers: {
          primary: makeProvider("deterministic", "throw"),
          fallback: makeProvider("deterministic", "throw")
        }
      }
    );
    expect(result.status).toBe(500);
  });
});

describe("POST /api/resume-intelligence — log discipline", () => {
  it("never includes raw resume text or the resumeId value in any log entry", async () => {
    const sensitive = `Confidential resume\n${SECRET_RESUME_LITERAL}\nMore body text follows.`;
    const longEnough = `${sensitive}\n${SAMPLE_RESUME_TEXT}`;
    const result = await handleResumeIntelligence(
      { resumeId: "r1", resumeText: longEnough },
      {
        providers: {
          primary: makeProvider("openai", "throw"),
          fallback: makeProvider("deterministic", "ok")
        }
      }
    );
    const allLogs = JSON.stringify(result.logs);
    expect(allLogs).not.toContain(SECRET_RESUME_LITERAL);
    expect(allLogs).not.toContain("Confidential resume");
    // The body itself must of course not echo the resumeText back.
    const body = result.body as { report?: { extractedProfile?: object } };
    expect(JSON.stringify(body)).not.toContain(SECRET_RESUME_LITERAL);
  });
});
