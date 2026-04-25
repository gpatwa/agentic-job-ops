import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { currentSession } from "../src/data/currentSession";
import type { NormalizedJob, Resume, UserProfile } from "../src/models/domain";
import {
  approveApplicationPackage,
  checkUnsupportedClaims,
  generateApplicationPackage,
  loadApplicationAnswers,
  loadApplicationPackages,
  updateApplicationAnswerDraft
} from "../src/services/applicationPackage";
import { applyDashboardJobAction } from "../src/services/applicationWorkflow";
import { createEmptyProfile } from "../src/services/profileService";

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

function profile(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    ...createEmptyProfile(currentSession),
    fullName: "Example User",
    email: "example@example.com",
    location: "Remote",
    workAuthorization: "Authorized",
    targetTitles: ["Staff Product Manager"],
    targetLocations: ["Remote"],
    targetIndustries: ["B2B SaaS"],
    remotePreference: "remote",
    careerSummary:
      "Product leader focused on B2B SaaS workflow automation and customer discovery.",
    verifiedFacts: [
      "Led B2B SaaS workflow automation launches",
      "Partnered with engineering and design on customer discovery"
    ],
    ...overrides
  };
}

function resume(overrides: Partial<Resume> = {}): Resume {
  const now = new Date().toISOString();

  return {
    id: "resume_1",
    tenantId: currentSession.tenant.id,
    userId: currentSession.userId,
    originalFileName: "resume.pdf",
    fileUrl: "local-placeholder://resume.pdf",
    parsedText:
      "Example User led B2B SaaS workflow automation launches and partnered with engineering, design, and go-to-market teams.",
    status: "parsed",
    createdAt: now,
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
    source: "lever",
    sourceJobId: "lever_123",
    title: "Staff Product Manager",
    company: "ExampleCo",
    location: "Remote",
    remoteType: "remote",
    salaryMin: 160000,
    salaryMax: 190000,
    description:
      "ExampleCo is hiring a Staff Product Manager for B2B SaaS workflow automation, customer discovery, and cross-functional execution.",
    responsibilities: [
      "Lead customer discovery",
      "Partner with engineering and design on roadmap delivery"
    ],
    requirements: [
      "B2B SaaS product experience",
      "Experience launching workflow automation"
    ],
    applicationUrl: "https://example.com/jobs/123",
    atsType: "lever",
    postedAt: now,
    discoveredAt: now,
    scoringStatus: "scored",
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

describe("application package generation", () => {
  beforeEach(() => {
    installLocalStorageMock();
  });

  afterEach(() => {
    Reflect.deleteProperty(globalThis, "window");
  });

  it("generates a reviewable deterministic package with default answers", async () => {
    const workflow = applyDashboardJobAction(
      currentSession,
      "job_1",
      "start_application_prep"
    );

    const result = await generateApplicationPackage({
      session: currentSession,
      application: workflow.application,
      profile: profile(),
      resume: resume(),
      job: job(),
      match: null
    });

    expect(result.package.status).toBe("ready_for_review");
    expect(result.package.generationMode).toBe("deterministic");
    expect(result.package.tenantId).toBe(currentSession.tenant.id);
    expect(result.package.userId).toBe(currentSession.userId);
    expect(result.package.applicationRecordId).toBe(workflow.application.id);
    expect(result.package.resumeMarkdown).toContain("Staff Product Manager");
    expect(result.package.coverLetter).toContain("ExampleCo");
    expect(result.answers).toHaveLength(4);
    expect(result.answers[0].confidence).toBe("high");
    expect(loadApplicationPackages(currentSession)).toHaveLength(1);
    expect(loadApplicationAnswers(currentSession)).toHaveLength(4);
  });

  it("flags unsupported companies, tools, credentials, and unverified metrics", () => {
    const warnings = checkUnsupportedClaims({
      text:
        "I led Google Kubernetes work, earned AWS Certified credentials, and improved conversion by 40%.",
      profile: profile({ verifiedFacts: ["Led workflow automation launches"] }),
      resume: null,
      job: job({ description: "ExampleCo needs customer discovery." })
    });

    expect(warnings).toContain("Unsupported company mention: Google");
    expect(warnings).toContain("Unsupported tool mention: Kubernetes");
    expect(warnings).toContain("Unsupported degree or certification mention: AWS Certified");
    expect(warnings).toContain("Metric needs verification before use: 40%");
  });

  it("marks edited answers as user edited and refreshes package warnings", async () => {
    const workflow = applyDashboardJobAction(
      currentSession,
      "job_1",
      "start_application_prep"
    );
    const generated = await generateApplicationPackage({
      session: currentSession,
      application: workflow.application,
      profile: profile(),
      resume: resume(),
      job: job(),
      match: null
    });

    const result = updateApplicationAnswerDraft(
      currentSession,
      generated.answers[0].id,
      "I worked at Google on Kubernetes.",
      {
        profile: profile(),
        resume: resume(),
        job: job(),
        match: null
      }
    );

    const edited = result.answers.find((answer) => answer.id === generated.answers[0].id);
    expect(edited?.source).toBe("user_edited");
    expect(edited?.needsUserReview).toBe(false);
    expect(result.package.safetyWarnings).toContain(
      "Unsupported company mention: Google"
    );
    expect(result.package.safetyWarnings).toContain(
      "Unsupported tool mention: Kubernetes"
    );
  });

  it("approves a package and moves the application record to approved", async () => {
    const workflow = applyDashboardJobAction(
      currentSession,
      "job_1",
      "start_application_prep"
    );
    const generated = await generateApplicationPackage({
      session: currentSession,
      application: workflow.application,
      profile: profile(),
      resume: resume(),
      job: job(),
      match: null
    });

    const result = approveApplicationPackage(currentSession, generated.package.id);

    expect(result.package.status).toBe("approved");
    expect(result.package.approvedAt).not.toBeNull();
    expect(result.application.status).toBe("approved");
  });
});
