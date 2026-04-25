import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { currentSession } from "../src/data/currentSession";
import type {
  ApplicationAnswer,
  ApplicationPackage,
  NormalizedJob,
  Resume,
  UserProfile
} from "../src/models/domain";
import {
  approveBrowserSubmit,
  loadBrowserApplicationSessions,
  markBrowserSessionManualRequired,
  markBrowserSessionReadyForReview,
  startBrowserApplicationSession,
  submitApprovedBrowserApplication
} from "../src/services/browserApplicationAssistant";
import {
  saveApplicationAnswers,
  saveApplicationPackages
} from "../src/services/applicationPackage";
import { loadApplications, upsertApplicationRecord } from "../src/services/applicationService";
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
    phone: "555-0100",
    location: "Remote",
    workAuthorization: "Authorized to work in the United States",
    linkedinUrl: "https://www.linkedin.com/in/example",
    portfolioUrl: "https://example.com",
    githubUrl: "https://github.com/example",
    targetTitles: ["Product Manager"],
    salaryTarget: 180000,
    verifiedFacts: ["Led workflow automation launches"],
    ...overrides
  };
}

function resume(): Resume {
  const now = new Date().toISOString();
  return {
    id: "resume_1",
    tenantId: currentSession.tenant.id,
    userId: currentSession.userId,
    originalFileName: "resume.pdf",
    fileUrl: "local-placeholder://resume.pdf",
    parsedText: "Example User led workflow automation launches.",
    status: "parsed",
    createdAt: now
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
    sourceJobId: "job_1",
    title: "Product Manager",
    company: "ExampleCo",
    location: "Remote",
    remoteType: "remote",
    salaryMin: 160000,
    salaryMax: 190000,
    description: "Build workflow automation products.",
    responsibilities: ["Partner with engineering"],
    requirements: ["Product management experience"],
    applicationUrl: "https://boards.greenhouse.io/example/jobs/123",
    atsType: "greenhouse",
    postedAt: now,
    discoveredAt: now,
    scoringStatus: "scored",
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

function applicationPackage(
  applicationRecordId: string,
  overrides: Partial<ApplicationPackage> = {}
): ApplicationPackage {
  const now = new Date().toISOString();
  return {
    id: "pkg_1",
    tenantId: currentSession.tenant.id,
    userId: currentSession.userId,
    jobId: "job_1",
    applicationRecordId,
    status: "approved",
    resumeMarkdown: "# Example User\n\nLed workflow automation launches.",
    coverLetter: "Dear hiring team,\n\nI am interested in the role.",
    generationMode: "deterministic",
    modelName: "test",
    promptVersion: "test",
    inputHash: "input",
    outputHash: "output",
    safetyWarnings: [],
    createdAt: now,
    updatedAt: now,
    approvedAt: now,
    rejectedAt: null,
    ...overrides
  };
}

function answers(packageId: string): ApplicationAnswer[] {
  const now = new Date().toISOString();
  return [
    {
      id: "answer_1",
      tenantId: currentSession.tenant.id,
      userId: currentSession.userId,
      applicationPackageId: packageId,
      question: "What makes you a strong fit?",
      answer: "I have verified workflow automation launch experience.",
      confidence: "high",
      source: "user_edited",
      needsUserReview: false,
      createdAt: now,
      updatedAt: now
    }
  ];
}

function setupApprovedPackage() {
  const application = upsertApplicationRecord(currentSession, "job_1", {
    status: "approved"
  });
  const packageRecord = applicationPackage(application.id);
  saveApplicationPackages(currentSession, [packageRecord]);
  saveApplicationAnswers(currentSession, answers(packageRecord.id));

  return { application, packageRecord };
}

describe("browser application assistant", () => {
  beforeEach(() => {
    installLocalStorageMock();
  });

  afterEach(() => {
    Reflect.deleteProperty(globalThis, "window");
  });

  it("creates a browser session from an approved package and pauses on controlled fields", async () => {
    const { application, packageRecord } = setupApprovedPackage();

    const result = await startBrowserApplicationSession({
      session: currentSession,
      actorUserId: currentSession.userId,
      applicationPackage: packageRecord,
      application,
      job: job(),
      profile: profile(),
      resume: resume(),
      answers: answers(packageRecord.id)
    });

    expect(result.session.tenantId).toBe(currentSession.tenant.id);
    expect(result.session.userId).toBe(currentSession.userId);
    expect(result.session.atsType).toBe("greenhouse");
    expect(result.session.status).toBe("needs_user_input");
    expect(result.session.fieldsDetected.length).toBeGreaterThan(0);
    expect(result.session.fieldsFilled.map((field) => field.fieldId)).toContain(
      "full_name"
    );
    expect(result.session.uncertainFields.map((field) => field.reason)).toContain(
      "captcha"
    );
    expect(result.session.uncertainFields.map((field) => field.reason)).toContain(
      "final_submit"
    );
    expect(loadBrowserApplicationSessions(currentSession)).toHaveLength(1);
    expect(result.auditEvents.map((event) => event.action)).toContain(
      "browser_session_created"
    );
    expect(result.auditEvents.map((event) => event.action)).toContain(
      "uncertain_field_detected"
    );
  });

  it("blocks browser apply before the package is approved", async () => {
    const application = upsertApplicationRecord(currentSession, "job_1", {
      status: "needs_review"
    });
    const packageRecord = applicationPackage(application.id, {
      status: "ready_for_review",
      approvedAt: null
    });

    await expect(
      startBrowserApplicationSession({
        session: currentSession,
        actorUserId: currentSession.userId,
        applicationPackage: packageRecord,
        application,
        job: job(),
        profile: profile(),
        resume: resume(),
        answers: []
      })
    ).rejects.toThrow("approved package");
  });

  it("requires ready-for-review state and job-seeker approval before submit", async () => {
    const { application, packageRecord } = setupApprovedPackage();
    const started = await startBrowserApplicationSession({
      session: currentSession,
      actorUserId: currentSession.userId,
      applicationPackage: packageRecord,
      application,
      job: job(),
      profile: profile(),
      resume: resume(),
      answers: answers(packageRecord.id)
    });

    expect(() =>
      approveBrowserSubmit(currentSession, started.session.id, {
        actorUserId: currentSession.userId,
        approvedByUser: true
      })
    ).toThrow("after human review");

    const ready = markBrowserSessionReadyForReview(
      currentSession,
      started.session.id
    );

    expect(() =>
      approveBrowserSubmit(currentSession, ready.session.id, {
        actorUserId: "coach_user",
        approvedByUser: true
      })
    ).toThrow("Only the job seeker");

    const approved = approveBrowserSubmit(currentSession, ready.session.id, {
      actorUserId: currentSession.userId,
      approvedByUser: true
    });
    expect(approved.session.status).toBe("approved_for_submit");

    const submitted = await submitApprovedBrowserApplication(
      currentSession,
      approved.session.id
    );
    expect(submitted.session.status).toBe("submitted");
    expect(loadApplications(currentSession)[0].status).toBe("submitted");
  });

  it("supports a manual-required fallback without deleting the session", async () => {
    const { application, packageRecord } = setupApprovedPackage();
    const started = await startBrowserApplicationSession({
      session: currentSession,
      actorUserId: currentSession.userId,
      applicationPackage: packageRecord,
      application,
      job: job(),
      profile: profile({ salaryTarget: null }),
      resume: resume(),
      answers: answers(packageRecord.id)
    });

    const result = markBrowserSessionManualRequired(
      currentSession,
      started.session.id,
      "CAPTCHA requires manual completion."
    );

    expect(result.session.status).toBe("manual_required");
    expect(result.session.errorMessage).toBe("CAPTCHA requires manual completion.");
    expect(loadBrowserApplicationSessions(currentSession)).toHaveLength(1);
    expect(result.auditEvents[0].action).toBe("manual_application_required");
  });
});
