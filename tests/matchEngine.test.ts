import { describe, expect, it } from "vitest";
import { currentSession } from "../src/data/currentSession";
import type { NormalizedJob, UserProfile } from "../src/models/domain";
import {
  queueFromRecommendation,
  scoreJobsForProfile
} from "../src/services/matchEngine";
import { createEmptyProfile } from "../src/services/profileService";

function profile(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    ...createEmptyProfile(currentSession),
    fullName: "Example User",
    email: "example@example.com",
    location: "Remote",
    workAuthorization: "Authorized",
    targetTitles: ["Staff Engineer"],
    targetLocations: ["Remote"],
    targetIndustries: ["SaaS"],
    remotePreference: "remote",
    salaryMin: 150000,
    salaryTarget: 180000,
    careerSummary: "Staff engineer building TypeScript React distributed systems.",
    verifiedFacts: ["Built TypeScript platforms", "Led distributed systems work"],
    ...overrides
  };
}

function job(overrides: Partial<NormalizedJob> = {}): NormalizedJob {
  const now = new Date().toISOString();

  return {
    id: "job_1",
    tenantId: currentSession.tenant.id,
    userId: currentSession.userId,
    sourceConfigId: "source_1",
    source: "greenhouse",
    sourceJobId: "123",
    title: "Staff Engineer",
    company: "Good SaaS",
    location: "Remote",
    remoteType: "remote",
    salaryMin: 190000,
    salaryMax: 220000,
    description:
      "Good SaaS is hiring a Staff Engineer to build TypeScript, React, and distributed systems platforms for enterprise customers. The role partners across product and engineering.",
    responsibilities: [
      "Lead distributed systems design",
      "Partner with product teams on enterprise SaaS workflows"
    ],
    requirements: [
      "Deep TypeScript experience",
      "Experience leading React platform work"
    ],
    applicationUrl: "https://example.com/jobs/123",
    atsType: "greenhouse",
    postedAt: now,
    discoveredAt: now,
    scoringStatus: "queued",
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

describe("scoreJobsForProfile", () => {
  it("scores strong matches into apply review", async () => {
    const result = await scoreJobsForProfile(currentSession, profile(), [job()], []);

    expect(result.matches[0].recommendation).toBe("apply");
    expect(result.matches[0].queue).toBe("apply_review");
    expect(result.matches[0].overallScore).toBeGreaterThanOrEqual(8);
    expect(result.jobs[0].scoringStatus).toBe("scored");
    expect(result.profileWarning).toBe("");
  });

  it("forces companies to avoid into skip while keeping them browsable", async () => {
    const result = await scoreJobsForProfile(
      currentSession,
      profile({ companiesToAvoid: ["AvoidCo"] }),
      [job({ company: "AvoidCo" })],
      []
    );

    expect(result.matches[0].recommendation).toBe("skip");
    expect(result.matches[0].queue).toBe("browse");
    expect(result.matches[0].overallScore).toBeLessThan(3);
    expect(result.jobs[0].scoringStatus).toBe("skipped");
    expect(result.matches[0].topGaps).toContain(
      "Company is listed in companies to avoid."
    );
  });

  it("scores weak job descriptions conservatively", async () => {
    const result = await scoreJobsForProfile(
      currentSession,
      profile(),
      [
        job({
          description: "Short posting.",
          responsibilities: [],
          requirements: [],
          salaryMin: null,
          salaryMax: null
        })
      ],
      []
    );

    expect(result.matches[0].overallScore).toBeLessThanOrEqual(5.4);
    expect(result.matches[0].queue).toBe("browse");
    expect(result.matches[0].topGaps).toContain(
      "Job description is missing or too thin for a confident score."
    );
  });

  it("warns but still scores incomplete profiles", async () => {
    const result = await scoreJobsForProfile(
      currentSession,
      createEmptyProfile(currentSession),
      [job()],
      []
    );

    expect(result.matches[0].overallScore).toBeGreaterThan(0);
    expect(result.profileWarning).toContain("Profile is incomplete");
    expect(result.matches[0].topGaps[0]).toContain("Profile is incomplete");
  });
});

describe("queueFromRecommendation", () => {
  it("keeps skip recommendations browsable", () => {
    expect(queueFromRecommendation("apply")).toBe("apply_review");
    expect(queueFromRecommendation("maybe")).toBe("maybe");
    expect(queueFromRecommendation("browse")).toBe("browse");
    expect(queueFromRecommendation("skip")).toBe("browse");
  });
});
