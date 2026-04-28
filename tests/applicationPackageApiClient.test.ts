import { describe, expect, it, vi } from "vitest";
import { currentSession } from "../src/data/currentSession";
import {
  ApiBackedApplicationPackageError,
  createApiBackedApplicationPackageGenerator
} from "../src/services/applicationPackageApiClient";
import type {
  ApplicationRecord,
  NormalizedJob,
  Resume,
  UserProfile
} from "../src/models/domain";

function fakeJob(): NormalizedJob {
  const now = new Date().toISOString();
  return {
    id: "job_test",
    tenantId: currentSession.tenant.id,
    userId: currentSession.userId,
    sourceConfigId: null,
    source: "manual",
    sourceJobId: "job_test",
    title: "Senior Engineer",
    company: "Spring Health",
    location: "Remote",
    remoteType: "remote",
    salaryMin: null,
    salaryMax: null,
    description: "Build great mental-health software.",
    responsibilities: ["Mentor"],
    requirements: ["TypeScript"],
    applicationUrl: "https://example.com/job",
    atsType: "manual",
    postedAt: null,
    discoveredAt: now,
    scoringStatus: "scored",
    createdAt: now,
    updatedAt: now
  };
}

function fakeProfile(): UserProfile {
  const now = new Date().toISOString();
  return {
    id: "profile_test",
    tenantId: currentSession.tenant.id,
    userId: currentSession.userId,
    fullName: "Gopal Patwa",
    email: "g@example.com",
    phone: "",
    location: "Bay Area",
    linkedinUrl: "",
    githubUrl: "",
    portfolioUrl: "",
    workAuthorization: "",
    targetTitles: ["Senior Engineering Manager"],
    targetLocations: ["Remote"],
    targetIndustries: ["B2B SaaS"],
    remotePreference: "remote",
    salaryMin: null,
    salaryTarget: null,
    companiesToAvoid: [],
    companiesToPrioritize: [],
    careerSummary: "20 years building data platforms.",
    verifiedFacts: ["Scaled team from 1 to 8"],
    visaSponsorshipNeeded: "",
    howDidYouHearAboutUs: "",
    genderIdentity: "",
    raceEthnicity: "",
    veteranStatus: "",
    disabilityStatus: "",
    createdAt: now,
    updatedAt: now
  };
}

function fakeResume(): Resume {
  return {
    id: "resume_test",
    tenantId: currentSession.tenant.id,
    userId: currentSession.userId,
    originalFileName: "test.pdf",
    fileUrl: "test://resume",
    parsedText: "Gopal Patwa — full resume text would go here.",
    status: "parsed",
    createdAt: new Date().toISOString()
  };
}

function fakeApplication(): ApplicationRecord {
  const now = new Date().toISOString();
  return {
    id: "app_test",
    tenantId: currentSession.tenant.id,
    userId: currentSession.userId,
    jobId: "job_test",
    status: "draft_prepared",
    notes: "",
    createdAt: now,
    updatedAt: now
  };
}

function llmSuccessResponse(): Response {
  return new Response(
    JSON.stringify({
      mode: "llm",
      provider: "openai",
      modelName: "openai:gpt-4.1-mini",
      promptVersion: "application-package-llm-v1",
      fallbackUsed: false,
      content: {
        resumeMarkdown: "# Gopal\n\nReal LLM-generated resume markdown",
        coverLetter: "",
        answers: [
          {
            question: "Why are you interested in this role?",
            answer: "Quality LLM answer grounded in resume.",
            confidence: "high",
            needsUserReview: false,
            rationale: "Resume mentions team scaling"
          }
        ]
      }
    }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
}

describe("ApiBackedApplicationPackageGenerator — success path", () => {
  it("POSTs to /api/ai/application-package and returns the LLM content", async () => {
    let capturedUrl = "";
    // Loose typing — `any` is fine in test scope; we just want to
     // assert specific keys exist on the captured request body.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let capturedBody: any = null;
    const fetcher = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        capturedUrl = typeof input === "string" ? input : String(input);
        capturedBody = init?.body
          ? (JSON.parse(String(init.body)) as Record<string, unknown>)
          : null;
        return llmSuccessResponse();
      }
    );

    const adapter = createApiBackedApplicationPackageGenerator({
      apiBaseUrl: "http://localhost:8787",
      fetcher: fetcher as unknown as typeof fetch
    });

    const result = await adapter.generate({
      session: currentSession,
      application: fakeApplication(),
      profile: fakeProfile(),
      resume: fakeResume(),
      job: fakeJob(),
      match: null
    });

    expect(capturedUrl).toBe(
      "http://localhost:8787/api/ai/application-package"
    );
    expect(capturedBody?.questions).toBeDefined();
    expect(capturedBody?.includeCoverLetter).toBe(false);
    expect(capturedBody?.resumeText).toContain("Gopal Patwa");
    expect(result.generationMode).toBe("llm");
    expect(result.modelName).toBe("openai:gpt-4.1-mini");
    expect(result.answers[0].confidence).toBe("high");
    expect(result.answers[0].answer).toContain("LLM");
  });

  it("requests a cover letter when includeCoverLetter is true in options", async () => {
    // Loose typing — `any` is fine in test scope; we just want to
     // assert specific keys exist on the captured request body.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let capturedBody: any = null;
    const fetcher = vi.fn(
      async (_input: string | URL | Request, init?: RequestInit) => {
        capturedBody = init?.body
          ? (JSON.parse(String(init.body)) as Record<string, unknown>)
          : null;
        return llmSuccessResponse();
      }
    );

    const adapter = createApiBackedApplicationPackageGenerator({
      apiBaseUrl: "http://localhost:8787",
      fetcher: fetcher as unknown as typeof fetch,
      includeCoverLetter: true
    });

    await adapter.generate({
      session: currentSession,
      application: fakeApplication(),
      profile: fakeProfile(),
      resume: fakeResume(),
      job: fakeJob(),
      match: null
    });

    expect(capturedBody?.includeCoverLetter).toBe(true);
  });
});

describe("ApiBackedApplicationPackageGenerator — failure paths", () => {
  it("throws ApiBackedApplicationPackageError on HTTP 5xx", async () => {
    const fetcher = vi.fn(
      async (): Promise<Response> => new Response("oops", { status: 500 })
    );
    const adapter = createApiBackedApplicationPackageGenerator({
      apiBaseUrl: "http://localhost:8787",
      fetcher: fetcher as unknown as typeof fetch
    });

    await expect(
      adapter.generate({
        session: currentSession,
        application: fakeApplication(),
        profile: fakeProfile(),
        resume: fakeResume(),
        job: fakeJob(),
        match: null
      })
    ).rejects.toBeInstanceOf(ApiBackedApplicationPackageError);
  });

  it("throws on network failure (so caller falls back to local deterministic)", async () => {
    const fetcher = vi.fn(async () => {
      throw new Error("network unreachable");
    });
    const adapter = createApiBackedApplicationPackageGenerator({
      apiBaseUrl: "http://localhost:8787",
      fetcher: fetcher as unknown as typeof fetch
    });

    await expect(
      adapter.generate({
        session: currentSession,
        application: fakeApplication(),
        profile: fakeProfile(),
        resume: fakeResume(),
        job: fakeJob(),
        match: null
      })
    ).rejects.toBeInstanceOf(ApiBackedApplicationPackageError);
  });

  it("throws on malformed response shape (route returned unexpected JSON)", async () => {
    const fetcher = vi.fn(
      async (): Promise<Response> =>
        new Response(JSON.stringify({ unexpected: "shape" }), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
    );
    const adapter = createApiBackedApplicationPackageGenerator({
      apiBaseUrl: "http://localhost:8787",
      fetcher: fetcher as unknown as typeof fetch
    });

    await expect(
      adapter.generate({
        session: currentSession,
        application: fakeApplication(),
        profile: fakeProfile(),
        resume: fakeResume(),
        job: fakeJob(),
        match: null
      })
    ).rejects.toBeInstanceOf(ApiBackedApplicationPackageError);
  });
});
