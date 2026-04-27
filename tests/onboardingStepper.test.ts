import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { currentSession } from "../src/data/currentSession";
import type {
  OnboardingState,
  Resume,
  ResumeIntelligenceReport
} from "../src/models/domain";
import { computeOnboardingStep } from "../src/pages/onboardingStep";
import {
  createDemoResume,
  createResumeFromText,
  DEMO_RESUME_TEXT
} from "../src/services/resumeService";

function installLocalStorageMock() {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, "window", {
    value: {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => store.set(key, value),
        removeItem: (key: string) => store.delete(key),
        clear: () => store.clear()
      }
    },
    configurable: true
  });
}

function makeResume(): Resume {
  const now = new Date().toISOString();
  return {
    id: "resume_step_test",
    tenantId: currentSession.tenant.id,
    userId: currentSession.userId,
    originalFileName: "resume.txt",
    fileUrl: "local-paste://resume/x.txt",
    parsedText: DEMO_RESUME_TEXT,
    status: "parsed",
    createdAt: now
  };
}

function makeReport(): ResumeIntelligenceReport {
  const now = new Date().toISOString();
  return {
    id: "ri_step_test",
    tenantId: currentSession.tenant.id,
    userId: currentSession.userId,
    resumeId: "resume_step_test",
    extractionMode: "deterministic",
    modelName: "deterministic-resume-intelligence-fallback",
    promptVersion: "resume-intelligence-v1",
    extractedProfile: {
      fullName: "Jane Doe",
      email: "jane@example.com",
      phone: "",
      location: "Remote",
      linkedinUrl: "https://www.linkedin.com/in/janedoe",
      githubUrl: "",
      portfolioUrl: "",
      currentTitle: "Senior Product Manager",
      seniorityLevel: "Senior",
      yearsOfExperience: 4,
      industries: ["B2B SaaS"],
      companies: [],
      jobTitles: ["Senior Product Manager"],
      education: [],
      certifications: [],
      skills: ["Product Management"],
      tools: [],
      projects: [],
      leadershipExamples: [],
      quantifiedAchievements: [],
      workAuthorization: "",
      resumeStrengths: [],
      resumeGaps: []
    },
    confidenceByField: {
      fullName: "high",
      email: "high",
      phone: "low",
      location: "medium",
      linkedinUrl: "high",
      githubUrl: "low",
      portfolioUrl: "low",
      currentTitle: "medium",
      seniorityLevel: "medium",
      yearsOfExperience: "medium",
      skills: "medium",
      industries: "medium"
    },
    missingFields: [],
    ambiguousFields: [],
    parsingWarnings: [],
    atsRiskScore: 0,
    atsRiskLevel: "low",
    suggestedFixes: [],
    createdAt: now,
    updatedAt: now
  };
}

function makeState(overrides: Partial<OnboardingState> = {}): OnboardingState {
  const now = new Date().toISOString();
  return {
    id: "onb_step",
    tenantId: currentSession.tenant.id,
    userId: currentSession.userId,
    selectedTargetRoles: [],
    onboardingJobsGenerated: false,
    onboardingJobsScored: false,
    firstApplyReadyJobsShown: false,
    firstJobReviewed: false,
    onboardingCompletedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

describe("computeOnboardingStep", () => {
  it("returns 'resume' when no resume exists", () => {
    expect(
      computeOnboardingStep({
        resume: null,
        report: null,
        state: makeState(),
        hasJobsShown: false
      })
    ).toBe("resume");
  });

  it("returns 'intelligence' when a resume exists but no report", () => {
    expect(
      computeOnboardingStep({
        resume: makeResume(),
        report: null,
        state: makeState(),
        hasJobsShown: false
      })
    ).toBe("intelligence");
  });

  it("returns 'targets' when a report exists but no target roles confirmed", () => {
    expect(
      computeOnboardingStep({
        resume: makeResume(),
        report: makeReport(),
        state: makeState(),
        hasJobsShown: false
      })
    ).toBe("targets");
  });

  it("returns 'jobs' once apply-ready jobs have been shown in-session", () => {
    expect(
      computeOnboardingStep({
        resume: makeResume(),
        report: makeReport(),
        state: makeState({ selectedTargetRoles: ["Senior Product Manager"] }),
        hasJobsShown: true
      })
    ).toBe("jobs");
  });

  it("returns 'jobs' when targets selected and the persisted state shows recommendations were already surfaced", () => {
    expect(
      computeOnboardingStep({
        resume: makeResume(),
        report: makeReport(),
        state: makeState({
          selectedTargetRoles: ["Senior Product Manager"],
          firstApplyReadyJobsShown: true
        }),
        hasJobsShown: false
      })
    ).toBe("jobs");
  });

  it("returns 'targets' when roles are selected but jobs have not been shown yet", () => {
    expect(
      computeOnboardingStep({
        resume: makeResume(),
        report: makeReport(),
        state: makeState({
          selectedTargetRoles: ["Senior Product Manager"]
        }),
        hasJobsShown: false
      })
    ).toBe("targets");
  });
});

describe("resume helpers", () => {
  beforeEach(() => installLocalStorageMock());
  afterEach(() => Reflect.deleteProperty(globalThis, "window"));

  it("createResumeFromText persists pasted text as the parsedText", () => {
    const resume = createResumeFromText(currentSession, "  Pasted resume text  \n");
    expect(resume.parsedText).toBe("Pasted resume text");
    expect(resume.fileUrl.startsWith("local-paste://")).toBe(true);
    expect(resume.status).toBe("parsed");
  });

  it("createDemoResume seeds a recognisable demo profile", () => {
    const resume = createDemoResume(currentSession);
    expect(resume.originalFileName).toBe("demo-resume.txt");
    expect(resume.parsedText).toContain("Jane Doe");
    expect(resume.parsedText).toContain("Senior Product Manager");
  });
});
