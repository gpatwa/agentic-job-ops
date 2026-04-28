import { describe, expect, it, vi } from "vitest";
import {
  handleApplicationPackage,
  type ApplicationPackageResponseBody
} from "../../../server/routes/applicationPackageRoute";
import type { ServerConfig } from "../../../server/config/env";
import { AiProviderError } from "../../../server/ai/aiProvider";

function fakeConfig(
  overrides: Partial<ServerConfig> = {}
): ServerConfig {
  return {
    apiPort: 8787,
    webOrigin: "http://localhost:5173",
    aiProvider: "openai",
    openai: {
      apiKey: "sk-test-fake-1234567890",
      resumeModel: "gpt-4.1-mini",
      jobModel: "gpt-4.1-mini"
    },
    azureOpenai: {
      endpoint: "",
      apiKey: "",
      apiVersion: "2024-08-01-preview",
      resumeDeployment: "",
      jobDeployment: ""
    },
    ...overrides
  };
}

const SECRET_RESUME_LITERAL = "RESUME_SECRET_DO_NOT_LOG_ME_42";

const VALID_BODY = {
  job: {
    title: "Senior Engineer",
    company: "Spring Health",
    description: "Build mental-health platform.",
    requirements: ["TypeScript", "Distributed systems"],
    responsibilities: ["Mentor engineers"]
  },
  profile: {
    fullName: "Gopal Patwa",
    careerSummary: "Senior engineering leader.",
    targetTitles: ["Senior Engineering Manager"],
    targetIndustries: ["B2B SaaS"],
    verifiedFacts: ["20 years of experience", "Scaled team from 1 to 8"]
  },
  resumeText: SECRET_RESUME_LITERAL,
  questions: [
    "Why are you interested in this role?",
    "What makes you a strong fit?"
  ],
  includeCoverLetter: false
};

describe("POST /api/ai/application-package — validation", () => {
  it("rejects an empty body with 400", async () => {
    const result = await handleApplicationPackage(
      {},
      { config: fakeConfig() }
    );
    expect(result.status).toBe(400);
    expect((result.body as { error: string }).error).toBe(
      "Invalid request body"
    );
  });

  it("accepts an empty questions array (resume-only generation)", async () => {
    // The user opted out of short-answer drafting OR every question
    // already has a saved-library hit. The route still produces
    // resume markdown (and optional cover letter) — it just skips
    // short-answer drafting.
    const callProvider = vi.fn(async () => ({
      output: {
        resumeMarkdown: "# Test",
        coverLetter: "",
        answers: []
      },
      provider: "openai" as const,
      modelName: "openai:gpt-4.1-mini",
      promptVersion: "application-package-llm-v1"
    }));
    const result = await handleApplicationPackage(
      { ...VALID_BODY, questions: [] },
      { config: fakeConfig(), callProvider }
    );
    expect(result.status).toBe(200);
    expect(callProvider).toHaveBeenCalledOnce();
  });

  it("requires a non-empty job title and company", async () => {
    const result = await handleApplicationPackage(
      { ...VALID_BODY, job: { ...VALID_BODY.job, title: "" } },
      { config: fakeConfig() }
    );
    expect(result.status).toBe(400);
  });
});

describe("POST /api/ai/application-package — provider success", () => {
  it("returns mode=llm with the provider's content when the call succeeds", async () => {
    const callProvider = vi.fn(async () => ({
      output: {
        resumeMarkdown: "# Gopal Patwa\n\n## Target Role\nSenior Engineer at Spring Health",
        coverLetter: "",
        answers: [
          {
            question: "Why are you interested in this role?",
            answer:
              "Mental-health technology aligns directly with my 20 years of platform engineering experience scaling teams from 1 to 8.",
            confidence: "high" as const,
            needs_user_review: false,
            rationale: "Backed by verified facts about team scaling"
          },
          {
            question: "What makes you a strong fit?",
            answer:
              "I bring distributed systems expertise and TypeScript fluency, both called out in your requirements.",
            confidence: "medium" as const,
            needs_user_review: false,
            rationale: ""
          }
        ]
      },
      provider: "openai" as const,
      modelName: "openai:gpt-4.1-mini",
      promptVersion: "application-package-llm-v1"
    }));

    const result = await handleApplicationPackage(VALID_BODY, {
      config: fakeConfig(),
      callProvider
    });

    expect(result.status).toBe(200);
    const body = result.body as ApplicationPackageResponseBody;
    expect(body.mode).toBe("llm");
    expect(body.provider).toBe("openai");
    expect(body.fallbackUsed).toBe(false);
    expect(body.content.answers).toHaveLength(2);
    expect(body.content.answers[0].confidence).toBe("high");
    expect(body.content.answers[0].rationale).toContain("verified facts");
    expect(callProvider).toHaveBeenCalledOnce();
  });

  it("passes the resume text + verified facts to the provider", async () => {
    let capturedInput: { resumeText: string; verifiedFacts: string[] } | null =
      null;
    const callProvider = vi.fn(async (_call, input) => {
      capturedInput = {
        resumeText: input.resumeText,
        verifiedFacts: input.verifiedFacts
      };
      return {
        output: {
          resumeMarkdown: "# Test",
          coverLetter: "",
          answers: [
            {
              question: VALID_BODY.questions[0],
              answer: "ok",
              confidence: "medium" as const,
              needs_user_review: true,
              rationale: ""
            }
          ]
        },
        provider: "openai" as const,
        modelName: "openai:gpt-4.1-mini",
        promptVersion: "application-package-llm-v1"
      };
    });

    await handleApplicationPackage(VALID_BODY, {
      config: fakeConfig(),
      callProvider
    });

    expect(capturedInput).not.toBeNull();
    expect(capturedInput!.resumeText).toBe(SECRET_RESUME_LITERAL);
    expect(capturedInput!.verifiedFacts).toEqual([
      "20 years of experience",
      "Scaled team from 1 to 8"
    ]);
  });
});

describe("POST /api/ai/application-package — fallback paths", () => {
  it("falls back to deterministic when the provider throws", async () => {
    const callProvider = vi.fn(async () => {
      throw new AiProviderError(
        "Application-package call timed out",
        "openai"
      );
    });
    const result = await handleApplicationPackage(VALID_BODY, {
      config: fakeConfig(),
      callProvider
    });
    expect(result.status).toBe(200);
    const body = result.body as ApplicationPackageResponseBody;
    expect(body.mode).toBe("deterministic");
    expect(body.provider).toBe("deterministic");
    expect(body.fallbackUsed).toBe(true);
    expect(body.content.answers).toHaveLength(VALID_BODY.questions.length);
    expect(body.content.answers.every((a) => a.confidence === "low")).toBe(true);
    expect(body.content.answers.every((a) => a.needsUserReview)).toBe(true);
  });

  it("returns mode=deterministic without calling the provider when no API key configured", async () => {
    const callProvider = vi.fn();
    const result = await handleApplicationPackage(VALID_BODY, {
      config: fakeConfig({
        openai: {
          apiKey: "",
          resumeModel: "gpt-4.1-mini",
          jobModel: "gpt-4.1-mini"
        }
      }),
      callProvider
    });
    expect(result.status).toBe(200);
    const body = result.body as ApplicationPackageResponseBody;
    expect(body.mode).toBe("deterministic");
    expect(callProvider).not.toHaveBeenCalled();
  });

  it("returns mode=deterministic when aiProvider is 'deterministic'", async () => {
    const callProvider = vi.fn();
    const result = await handleApplicationPackage(VALID_BODY, {
      config: fakeConfig({ aiProvider: "deterministic" }),
      callProvider
    });
    expect(result.status).toBe(200);
    const body = result.body as ApplicationPackageResponseBody;
    expect(body.mode).toBe("deterministic");
    expect(callProvider).not.toHaveBeenCalled();
  });
});

describe("POST /api/ai/application-package — logging redaction", () => {
  it("never includes the resume text in any log entry", async () => {
    const callProvider = vi.fn(async () => ({
      output: {
        resumeMarkdown: "# Test",
        coverLetter: "",
        answers: [
          {
            question: VALID_BODY.questions[0],
            answer: "ok",
            confidence: "medium" as const,
            needs_user_review: false,
            rationale: ""
          }
        ]
      },
      provider: "openai" as const,
      modelName: "openai:gpt-4.1-mini",
      promptVersion: "application-package-llm-v1"
    }));
    const result = await handleApplicationPackage(VALID_BODY, {
      config: fakeConfig(),
      callProvider
    });
    const allLogJson = JSON.stringify(result.logs);
    expect(allLogJson).not.toContain(SECRET_RESUME_LITERAL);
    expect(allLogJson).not.toContain("sk-test-fake-1234567890");
    expect(allLogJson).not.toContain("Senior engineering leader.");
  });

  it("never includes the resume text in the response body either", async () => {
    const callProvider = vi.fn(async () => ({
      output: {
        // The model would never echo the literal back; this asserts
        // the route doesn't accidentally pass-through unexpected
        // fields.
        resumeMarkdown: "# Test",
        coverLetter: "",
        answers: [
          {
            question: VALID_BODY.questions[0],
            answer: "ok",
            confidence: "medium" as const,
            needs_user_review: false,
            rationale: ""
          }
        ]
      },
      provider: "openai" as const,
      modelName: "openai:gpt-4.1-mini",
      promptVersion: "application-package-llm-v1"
    }));
    const result = await handleApplicationPackage(VALID_BODY, {
      config: fakeConfig(),
      callProvider
    });
    const body = JSON.stringify(result.body);
    expect(body).not.toContain(SECRET_RESUME_LITERAL);
  });
});
