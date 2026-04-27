import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { currentSession } from "../src/data/currentSession";
import type { Resume } from "../src/models/domain";
import {
  OpenAIResumeIntelligenceAdapterError,
  createOpenAIResumeIntelligenceAdapter,
  openaiAdapterAvailable,
  pickOpenAIAdapterIfConfigured
} from "../src/services/openaiResumeIntelligenceAdapter";
import {
  createDeterministicResumeIntelligenceAdapter,
  selectResumeIntelligenceAdapter
} from "../src/services/resumeIntelligenceService";

// Local ambient declaration so this test file can mutate process.env in
// Node without pulling in @types/node project-wide. The adapter itself
// reads env defensively via globalThis (see openaiResumeIntelligenceAdapter
// readEnv) so this is purely a TypeScript convenience.
declare const process: { env: Record<string, string | undefined> };

function makeResume(text: string, id = "resume_openai_test"): Resume {
  return {
    id,
    tenantId: currentSession.tenant.id,
    userId: currentSession.userId,
    originalFileName: "resume.txt",
    fileUrl: "local://resume.txt",
    parsedText: text,
    status: "parsed",
    createdAt: new Date().toISOString()
  };
}

const PRODUCT_RESUME = `Jane Doe
Senior Product Manager
Remote
jane.doe@example.com
+1 555-555-0100
https://www.linkedin.com/in/janedoe

Experience
Senior Product Manager — DemoLabs — 2022 - 2026
Led B2B SaaS workflow automation roadmap; +20% activation.

Skills
Product Management, Roadmap, SQL`;

/** A minimal-but-schema-valid LLM response payload. */
function validLlmContent(overrides: Partial<Record<string, unknown>> = {}): string {
  const base = {
    extractedProfile: {
      fullName: "Jane Doe",
      email: "jane.doe@example.com",
      phone: "+1 555-555-0100",
      location: "Remote",
      linkedinUrl: "https://www.linkedin.com/in/janedoe",
      githubUrl: "",
      portfolioUrl: "",
      currentTitle: "Senior Product Manager",
      seniorityLevel: "Senior",
      yearsOfExperience: 4,
      industries: ["B2B SaaS"],
      companies: ["DemoLabs"],
      jobTitles: ["Senior Product Manager"],
      education: [],
      certifications: [],
      skills: ["Product Management", "Roadmap", "SQL"],
      tools: [],
      projects: [],
      leadershipExamples: [],
      quantifiedAchievements: ["+20% activation"],
      workAuthorization: "",
      resumeStrengths: [],
      resumeGaps: []
    },
    confidenceByField: {
      fullName: "high",
      email: "high",
      phone: "medium",
      location: "medium",
      linkedinUrl: "high",
      githubUrl: "low",
      portfolioUrl: "low",
      currentTitle: "high",
      seniorityLevel: "high",
      yearsOfExperience: "medium",
      skills: "medium",
      industries: "medium"
    },
    missingFields: [],
    ambiguousFields: [],
    parsingWarnings: [],
    atsRiskScore: 12,
    atsRiskLevel: "low",
    suggestedFixes: [],
    recommendation: {
      strongestRoles: [
        {
          title: "Senior Product Manager",
          fitLevel: "strong",
          confidence: "high",
          why: "Direct title match.",
          evidenceFromResume: ["Senior Product Manager — DemoLabs"],
          searchKeywords: ["product manager"],
          suggestedResumeAngle: "Lead with workflow automation outcomes."
        }
      ],
      adjacentRoles: [],
      stretchRoles: [],
      rolesToAvoid: [],
      recommendedIndustries: ["B2B SaaS"],
      recommendedSeniority: "Senior",
      recommendedSearchKeywords: ["product manager"],
      positioningSummary: "Strongest fit: B2B SaaS PM.",
      resumePositioningAdvice: ["Lead with measurable outcomes."],
      skillGaps: [],
      confidence: "high"
    },
    ...overrides
  };
  return JSON.stringify(base);
}

function mockFetchOk(content: string) {
  // Typed signature so `fetchImpl.mock.calls[0]` destructures as
  // `[string | URL | Request, RequestInit | undefined]` for the request-shape
  // assertions below.
  return vi.fn(
    async (
      _input: string | URL | Request,
      _init?: RequestInit
    ): Promise<Response> =>
      new Response(
        JSON.stringify({ choices: [{ message: { content } }] }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
  );
}

const OPENAI_KEY_BEFORE = process.env.OPENAI_API_KEY;

beforeEach(() => {
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_RESUME_MODEL;
});

afterEach(() => {
  if (OPENAI_KEY_BEFORE === undefined) {
    delete process.env.OPENAI_API_KEY;
  } else {
    process.env.OPENAI_API_KEY = OPENAI_KEY_BEFORE;
  }
});

describe("openaiAdapterAvailable", () => {
  it("returns false when no key is set in env", () => {
    expect(openaiAdapterAvailable()).toBe(false);
  });

  it("returns true when OPENAI_API_KEY is set in env", () => {
    process.env.OPENAI_API_KEY = "sk-test-12345";
    expect(openaiAdapterAvailable()).toBe(true);
  });

  it("treats blank-string keys as not configured", () => {
    process.env.OPENAI_API_KEY = "   ";
    expect(openaiAdapterAvailable()).toBe(false);
  });
});

describe("pickOpenAIAdapterIfConfigured", () => {
  it("returns null without a key so callers fall back deterministically", () => {
    expect(pickOpenAIAdapterIfConfigured()).toBeNull();
  });

  it("returns an adapter instance when a key is set", () => {
    process.env.OPENAI_API_KEY = "sk-test-12345";
    expect(pickOpenAIAdapterIfConfigured()?.name).toBe(
      "openai-resume-intelligence-adapter"
    );
  });
});

describe("selectResumeIntelligenceAdapter", () => {
  it("falls back to the deterministic adapter when no key is set", () => {
    expect(selectResumeIntelligenceAdapter().name).toBe(
      "deterministic-resume-intelligence-adapter"
    );
  });

  it("picks the OpenAI adapter when OPENAI_API_KEY is set", () => {
    process.env.OPENAI_API_KEY = "sk-test-12345";
    expect(selectResumeIntelligenceAdapter().name).toBe(
      "openai-resume-intelligence-adapter"
    );
  });
});

describe("OpenAIResumeIntelligenceAdapter — request shape", () => {
  it("sends a chat-completion request with bearer auth and json_object format", async () => {
    const fetchImpl = mockFetchOk(validLlmContent());
    const adapter = createOpenAIResumeIntelligenceAdapter({
      apiKey: "sk-test-12345",
      model: "gpt-test",
      fetchImpl: fetchImpl as unknown as typeof fetch
    });

    const out = await adapter.analyze({ resume: makeResume(PRODUCT_RESUME) });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [, init] = fetchImpl.mock.calls[0];
    const headers = init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer sk-test-12345");
    expect(headers["Content-Type"]).toBe("application/json");
    const body = JSON.parse(init?.body as string);
    expect(body.model).toBe("gpt-test");
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.temperature).toBe(0);

    expect(out.extractionMode).toBe("llm");
    expect(out.modelName).toBe("gpt-test");
    expect(out.promptVersion).toBe("resume-intelligence-openai-v1");
  });

  it("uses OPENAI_RESUME_MODEL when no model override is passed", async () => {
    process.env.OPENAI_API_KEY = "sk-test-12345";
    process.env.OPENAI_RESUME_MODEL = "gpt-from-env";
    const fetchImpl = mockFetchOk(validLlmContent());
    const adapter = createOpenAIResumeIntelligenceAdapter({
      fetchImpl: fetchImpl as unknown as typeof fetch
    });

    const out = await adapter.analyze({ resume: makeResume(PRODUCT_RESUME) });

    const [, init] = fetchImpl.mock.calls[0];
    const body = JSON.parse(init?.body as string);
    expect(body.model).toBe("gpt-from-env");
    expect(out.modelName).toBe("gpt-from-env");
  });
});

describe("OpenAIResumeIntelligenceAdapter — schema validation", () => {
  it("validates the LLM JSON against the existing Zod schemas", async () => {
    const fetchImpl = mockFetchOk(validLlmContent());
    const adapter = createOpenAIResumeIntelligenceAdapter({
      apiKey: "sk-test",
      fetchImpl: fetchImpl as unknown as typeof fetch
    });
    const out = await adapter.analyze({ resume: makeResume(PRODUCT_RESUME) });
    expect(out.recommendation.strongestRoles[0].title).toBe(
      "Senior Product Manager"
    );
  });

  it("throws OpenAIResumeIntelligenceAdapterError when the LLM returns invalid JSON", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({ choices: [{ message: { content: "not json" } }] }),
        { status: 200 }
      )
    );
    const adapter = createOpenAIResumeIntelligenceAdapter({
      apiKey: "sk-test",
      fetchImpl: fetchImpl as unknown as typeof fetch
    });
    await expect(
      adapter.analyze({ resume: makeResume(PRODUCT_RESUME) })
    ).rejects.toThrowError(OpenAIResumeIntelligenceAdapterError);
  });

  it("throws when the LLM returns JSON that fails schema validation", async () => {
    // Missing the entire `recommendation` block.
    const broken = JSON.stringify({ extractedProfile: {} });
    const fetchImpl = mockFetchOk(broken);
    const adapter = createOpenAIResumeIntelligenceAdapter({
      apiKey: "sk-test",
      fetchImpl: fetchImpl as unknown as typeof fetch
    });
    await expect(
      adapter.analyze({ resume: makeResume(PRODUCT_RESUME) })
    ).rejects.toThrowError(OpenAIResumeIntelligenceAdapterError);
  });

  it("throws when OpenAI returns a non-2xx response", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response("rate limited", { status: 429 })
    );
    const adapter = createOpenAIResumeIntelligenceAdapter({
      apiKey: "sk-test",
      fetchImpl: fetchImpl as unknown as typeof fetch
    });
    await expect(
      adapter.analyze({ resume: makeResume(PRODUCT_RESUME) })
    ).rejects.toThrowError(OpenAIResumeIntelligenceAdapterError);
  });

  it("throws if no API key is present at call time", async () => {
    const adapter = createOpenAIResumeIntelligenceAdapter({});
    await expect(
      adapter.analyze({ resume: makeResume(PRODUCT_RESUME) })
    ).rejects.toThrowError(OpenAIResumeIntelligenceAdapterError);
  });
});

describe("OpenAIResumeIntelligenceAdapter — defense-in-depth", () => {
  it("forces fitLevel to match the bucket the role appears in", async () => {
    const overrides = {
      recommendation: {
        strongestRoles: [],
        adjacentRoles: [
          {
            title: "Director of Product",
            // Model claims "strong" but the role is in adjacentRoles —
            // adapter must demote.
            fitLevel: "strong",
            confidence: "high",
            why: "Adjacent fit.",
            evidenceFromResume: ["Led product team"],
            searchKeywords: ["director of product"],
            suggestedResumeAngle: ""
          }
        ],
        stretchRoles: [],
        rolesToAvoid: [],
        recommendedIndustries: [],
        recommendedSeniority: "",
        recommendedSearchKeywords: [],
        positioningSummary: "",
        resumePositioningAdvice: [],
        skillGaps: [],
        confidence: "medium"
      }
    };
    const fetchImpl = mockFetchOk(validLlmContent(overrides));
    const adapter = createOpenAIResumeIntelligenceAdapter({
      apiKey: "sk-test",
      fetchImpl: fetchImpl as unknown as typeof fetch
    });
    const out = await adapter.analyze({ resume: makeResume(PRODUCT_RESUME) });
    expect(out.recommendation.adjacentRoles[0].fitLevel).toBe("adjacent");
  });

  it("dedupes a title across strongest/adjacent buckets, keeping strongest", async () => {
    const overrides = {
      recommendation: {
        strongestRoles: [
          {
            title: "Director of Product",
            fitLevel: "strong",
            confidence: "high",
            why: "Direct match.",
            evidenceFromResume: ["Director of Product, Acme"],
            searchKeywords: ["director of product"],
            suggestedResumeAngle: ""
          }
        ],
        adjacentRoles: [
          {
            title: "director of product",
            fitLevel: "adjacent",
            confidence: "medium",
            why: "Duplicate.",
            evidenceFromResume: ["Led product team"],
            searchKeywords: [],
            suggestedResumeAngle: ""
          }
        ],
        stretchRoles: [],
        rolesToAvoid: [],
        recommendedIndustries: [],
        recommendedSeniority: "",
        recommendedSearchKeywords: [],
        positioningSummary: "",
        resumePositioningAdvice: [],
        skillGaps: [],
        confidence: "high"
      }
    };
    const fetchImpl = mockFetchOk(validLlmContent(overrides));
    const adapter = createOpenAIResumeIntelligenceAdapter({
      apiKey: "sk-test",
      fetchImpl: fetchImpl as unknown as typeof fetch
    });
    const out = await adapter.analyze({ resume: makeResume(PRODUCT_RESUME) });
    expect(out.recommendation.strongestRoles).toHaveLength(1);
    expect(out.recommendation.adjacentRoles).toHaveLength(0);
  });

  it("demotes a 'strong' role with no evidence to 'adjacent'", async () => {
    const overrides = {
      recommendation: {
        strongestRoles: [
          {
            title: "Senior Product Manager",
            fitLevel: "strong",
            confidence: "high",
            why: "Claimed strong without evidence.",
            evidenceFromResume: [],
            searchKeywords: [],
            suggestedResumeAngle: ""
          }
        ],
        adjacentRoles: [],
        stretchRoles: [],
        rolesToAvoid: [],
        recommendedIndustries: [],
        recommendedSeniority: "",
        recommendedSearchKeywords: [],
        positioningSummary: "",
        resumePositioningAdvice: [],
        skillGaps: [],
        confidence: "high"
      }
    };
    const fetchImpl = mockFetchOk(validLlmContent(overrides));
    const adapter = createOpenAIResumeIntelligenceAdapter({
      apiKey: "sk-test",
      fetchImpl: fetchImpl as unknown as typeof fetch
    });
    const out = await adapter.analyze({ resume: makeResume(PRODUCT_RESUME) });
    expect(out.recommendation.strongestRoles[0].fitLevel).toBe("adjacent");
  });
});

describe("OpenAIResumeIntelligenceAdapter — log discipline", () => {
  it("never logs the raw resume text or the API key", async () => {
    const fetchImpl = mockFetchOk(validLlmContent());
    const apiKey = "sk-test-secret-12345";
    const sensitiveText = "TOP_SECRET_RESUME_BLOB_DO_NOT_LOG";
    const adapter = createOpenAIResumeIntelligenceAdapter({
      apiKey,
      fetchImpl: fetchImpl as unknown as typeof fetch
    });

    const captured: string[] = [];
    const channels = ["log", "info", "warn", "error", "debug"] as const;
    const original: Record<string, typeof console.log> = {} as Record<
      string,
      typeof console.log
    >;
    channels.forEach((channel) => {
      original[channel] = console[channel];
      console[channel] = ((...args: unknown[]) => {
        captured.push(args.map(String).join(" "));
      }) as typeof console.log;
    });

    try {
      await adapter.analyze({ resume: makeResume(sensitiveText) });
    } finally {
      channels.forEach((channel) => {
        console[channel] = original[channel];
      });
    }

    const blob = captured.join("\n");
    expect(blob).not.toContain(apiKey);
    expect(blob).not.toContain(sensitiveText);
  });
});

describe("Deterministic fallback contrast", () => {
  it("deterministic adapter still produces extractionMode=deterministic", async () => {
    const adapter = createDeterministicResumeIntelligenceAdapter();
    const out = await adapter.analyze({ resume: makeResume(PRODUCT_RESUME) });
    expect(out.extractionMode).toBe("deterministic");
  });
});
