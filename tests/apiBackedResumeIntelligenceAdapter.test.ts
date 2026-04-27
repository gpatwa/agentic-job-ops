import { describe, expect, it, vi } from "vitest";
import { currentSession } from "../src/data/currentSession";
import type { Resume } from "../src/models/domain";
import { createApiBackedResumeIntelligenceAdapter } from "../src/services/resumeIntelligenceService";

function makeResume(text: string, id = "resume_api_test"): Resume {
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

const SAMPLE = `Jane Doe
Senior Product Manager
jane@example.com
+1 555-555-0100

Experience
Senior Product Manager — DemoLabs — 2022 - 2026
Led B2B SaaS workflow automation roadmap; +20% activation.

Skills
Product Management, Roadmap`;

const VALID_API_BODY = {
  extractionMode: "llm",
  provider: "azure_openai",
  modelName: "deploy-x",
  promptVersion: "resume-intelligence-openai-v1",
  fallbackUsed: false,
  report: {
    extractionMode: "llm",
    provider: "azure_openai",
    modelName: "deploy-x",
    promptVersion: "resume-intelligence-openai-v1",
    extractedProfile: {
      fullName: "Jane Doe",
      email: "jane@example.com",
      phone: "+1 555-555-0100",
      location: "Remote",
      linkedinUrl: "",
      githubUrl: "",
      portfolioUrl: "",
      currentTitle: "Senior Product Manager",
      seniorityLevel: "Senior",
      yearsOfExperience: 4,
      industries: [],
      companies: [],
      jobTitles: [],
      education: [],
      certifications: [],
      skills: [],
      tools: [],
      projects: [],
      leadershipExamples: [],
      quantifiedAchievements: [],
      workAuthorization: "",
      resumeStrengths: [],
      resumeGaps: []
    },
    confidenceByField: {},
    missingFields: [],
    ambiguousFields: [],
    parsingWarnings: [],
    atsRiskScore: 10,
    atsRiskLevel: "low",
    suggestedFixes: [],
    recommendation: {
      strongestRoles: [],
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
  }
};

describe("createApiBackedResumeIntelligenceAdapter", () => {
  it("uses the API response when the backend is reachable, stamping the server's provider", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify(VALID_API_BODY), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
    );
    const adapter = createApiBackedResumeIntelligenceAdapter({
      fetchImpl: fetchImpl as unknown as typeof fetch
    });
    const out = await adapter.analyze({ resume: makeResume(SAMPLE) });
    expect(out.extractionMode).toBe("llm");
    expect(out.provider).toBe("azure_openai");
    expect(out.modelName).toBe("deploy-x");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("falls back to the deterministic adapter when the API server is unreachable", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const adapter = createApiBackedResumeIntelligenceAdapter({
      fetchImpl: fetchImpl as unknown as typeof fetch
    });
    const out = await adapter.analyze({ resume: makeResume(SAMPLE) });
    // No throw — deterministic output produced locally.
    expect(out.extractionMode).toBe("deterministic");
    expect(out.provider).toBe("deterministic");
    // And the deterministic adapter still extracted real fields.
    expect(out.extractedProfile.fullName).toBe("Jane Doe");
  });

  it("falls back when the API returns 5xx", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: "down" }), { status: 503 })
    );
    const adapter = createApiBackedResumeIntelligenceAdapter({
      fetchImpl: fetchImpl as unknown as typeof fetch
    });
    const out = await adapter.analyze({ resume: makeResume(SAMPLE) });
    expect(out.provider).toBe("deterministic");
  });

  it("falls back when the API returns malformed JSON", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response("not json", {
          status: 200,
          headers: { "content-type": "application/json" }
        })
    );
    const adapter = createApiBackedResumeIntelligenceAdapter({
      fetchImpl: fetchImpl as unknown as typeof fetch
    });
    const out = await adapter.analyze({ resume: makeResume(SAMPLE) });
    expect(out.provider).toBe("deterministic");
  });
});
