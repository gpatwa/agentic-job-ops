import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { currentSession } from "../src/data/currentSession";
import type {
  ApplicationAnswer,
  ApplicationPackage,
  AuditLog,
  BrowserApplicationSession,
  NormalizedJob,
  Resume,
  UserProfile
} from "../src/models/domain";
import {
  approveBrowserSubmit,
  loadBrowserApplicationSessions,
  markBrowserSessionManualRequired,
  markBrowserSessionReadyForReview,
  saveBrowserApplicationSessions,
  startBrowserApplicationSession,
  submitApprovedBrowserApplication
} from "../src/services/browserApplicationAssistant";
import {
  saveApplicationAnswers,
  saveApplicationPackages
} from "../src/services/applicationPackage";
import { loadApplications, upsertApplicationRecord } from "../src/services/applicationService";
import { appendAuditLog, loadAuditLogs } from "../src/services/auditLog";
import type { BrowserAuditEvent } from "../src/services/browserApplicationAssistant";
import { createEmptyProfile } from "../src/services/profileService";
import { scopedKey } from "../src/lib/storage";

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
    coverLetterIncluded: true,
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

function persistAuditEvents(events: BrowserAuditEvent[]) {
  events.forEach((event) => {
    appendAuditLog(currentSession, {
      action: event.action,
      resourceType: event.resourceType,
      resourceId: event.resourceId,
      metadata: event.metadata
    });
  });
}

function clearBlockingPauses(sessionId: string) {
  const sessions = loadBrowserApplicationSessions(currentSession).map((item) =>
    item.id === sessionId
      ? {
          ...item,
          uncertainFields: item.uncertainFields.filter(
            (field) =>
              field.reason !== "captcha" && field.reason !== "login_challenge"
          )
        }
      : item
  );
  saveBrowserApplicationSessions(currentSession, sessions);
}

function writeAuditLogsDirectly(logs: AuditLog[]) {
  const key = scopedKey(currentSession.tenant.id, currentSession.userId, "audit_logs");
  window.localStorage.setItem(key, JSON.stringify(logs));
}

async function setupReadySession(): Promise<{
  packageRecord: ApplicationPackage;
  readySession: BrowserApplicationSession;
}> {
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
  const ready = markBrowserSessionReadyForReview(
    currentSession,
    started.session.id
  );

  return {
    packageRecord,
    readySession: ready.session
  };
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
      "greenhouse_first_name"
    );
    expect(result.session.fillMode).toBe("dry_run");
    expect(result.session.adapterName).toBe("greenhouse-ats-adapter");
    expect(result.session.fillPlan.length).toBeGreaterThan(0);
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
    clearBlockingPauses(ready.session.id);

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
    expect(approved.session.fillMode).toBe("submit_after_approval");
    persistAuditEvents(approved.auditEvents);

    const submitted = await submitApprovedBrowserApplication(
      currentSession,
      approved.session.id,
      {
        name: "safe-fixture-submit-adapter",
        runDetection: vi.fn(),
        submit: vi.fn(async () => ({ submitted: true, confirmationDetected: true }))
      },
      { actorUserId: currentSession.userId }
    );
    expect(submitted.session.status).toBe("submitted");
    expect(loadApplications(currentSession)[0].status).toBe("submitted");
  });

  it("blocks submit when approval audit is missing or belongs to another session", async () => {
    const { readySession } = await setupReadySession();
    const approved = approveBrowserSubmit(currentSession, readySession.id, {
      actorUserId: currentSession.userId,
      approvedByUser: true
    });
    const submit = vi.fn(async () => ({ submitted: true }));

    await expect(
      submitApprovedBrowserApplication(currentSession, approved.session.id, {
        name: "test-adapter",
        runDetection: vi.fn(),
        submit
      })
    ).rejects.toThrow("persisted approval audit");
    expect(submit).not.toHaveBeenCalled();
    expect(loadApplications(currentSession)[0].status).toBe("approved");

    appendAuditLog(currentSession, {
      action: "user_approved_browser_submit",
      resourceType: "BrowserApplicationSession",
      resourceId: "other_session",
      metadata: {
        jobId: approved.session.jobId,
        applicationRecordId: approved.session.applicationRecordId,
        applicationPackageId: approved.session.applicationPackageId
      }
    });

    await expect(
      submitApprovedBrowserApplication(currentSession, approved.session.id, {
        name: "test-adapter",
        runDetection: vi.fn(),
        submit
      })
    ).rejects.toThrow("persisted approval audit");
    expect(submit).not.toHaveBeenCalled();
  });

  it("blocks submit if the package is no longer approved", async () => {
    const { packageRecord, readySession } = await setupReadySession();
    const approved = approveBrowserSubmit(currentSession, readySession.id, {
      actorUserId: currentSession.userId,
      approvedByUser: true
    });
    persistAuditEvents(approved.auditEvents);
    saveApplicationPackages(currentSession, [
      {
        ...packageRecord,
        status: "ready_for_review",
        approvedAt: null,
        updatedAt: new Date().toISOString()
      }
    ]);

    const submit = vi.fn(async () => ({ submitted: true }));
    await expect(
      submitApprovedBrowserApplication(currentSession, approved.session.id, {
        name: "test-adapter",
        runDetection: vi.fn(),
        submit
      })
    ).rejects.toThrow("package is approved");
    expect(submit).not.toHaveBeenCalled();
    expect(loadApplications(currentSession)[0].status).toBe("approved");
  });

  it("keeps application status unchanged when submit is not confirmed", async () => {
    const { readySession } = await setupReadySession();
    clearBlockingPauses(readySession.id);
    const approved = approveBrowserSubmit(currentSession, readySession.id, {
      actorUserId: currentSession.userId,
      approvedByUser: true
    });
    persistAuditEvents(approved.auditEvents);

    const submit = vi.fn(async () => ({ submitted: false }));
    const result = await submitApprovedBrowserApplication(
      currentSession,
      approved.session.id,
      {
        name: "test-adapter",
        runDetection: vi.fn(),
        submit
      }
    );

    expect(submit).toHaveBeenCalledTimes(1);
    expect(result.session.status).toBe("manual_required");
    expect(loadApplications(currentSession)[0].status).toBe("approved");
  });

  it("blocks submit when the approval audit was created by a different actor", async () => {
    const { readySession } = await setupReadySession();
    clearBlockingPauses(readySession.id);
    const approved = approveBrowserSubmit(currentSession, readySession.id, {
      actorUserId: currentSession.userId,
      approvedByUser: true
    });

    writeAuditLogsDirectly([
      {
        id: "audit_forged",
        tenantId: currentSession.tenant.id,
        actorUserId: "coach_user",
        action: "user_approved_browser_submit",
        resourceType: "BrowserApplicationSession",
        resourceId: approved.session.id,
        metadata: {
          jobId: approved.session.jobId,
          applicationRecordId: approved.session.applicationRecordId,
          applicationPackageId: approved.session.applicationPackageId,
          approvedFromStatus: "ready_for_review",
          approvedByUserId: "coach_user"
        },
        createdAt: new Date().toISOString()
      }
    ]);

    const submit = vi.fn(async () => ({ submitted: true }));
    await expect(
      submitApprovedBrowserApplication(
        currentSession,
        approved.session.id,
        { name: "test-adapter", runDetection: vi.fn(), submit },
        { actorUserId: currentSession.userId }
      )
    ).rejects.toThrow("persisted approval audit");
    expect(submit).not.toHaveBeenCalled();
    expect(loadApplications(currentSession)[0].status).toBe("approved");
  });

  it("blocks submit when the actor is not the job seeker and records a blocked-submit audit", async () => {
    const { readySession } = await setupReadySession();
    clearBlockingPauses(readySession.id);
    const approved = approveBrowserSubmit(currentSession, readySession.id, {
      actorUserId: currentSession.userId,
      approvedByUser: true
    });
    persistAuditEvents(approved.auditEvents);

    const submit = vi.fn(async () => ({ submitted: true }));
    await expect(
      submitApprovedBrowserApplication(
        currentSession,
        approved.session.id,
        { name: "test-adapter", runDetection: vi.fn(), submit },
        { actorUserId: "coach_user" }
      )
    ).rejects.toThrow("Only the job seeker");
    expect(submit).not.toHaveBeenCalled();
    expect(loadApplications(currentSession)[0].status).toBe("approved");

    const blockedAudits = loadAuditLogs(currentSession).filter(
      (log) =>
        log.action === "browser_submit_blocked" &&
        log.metadata.reason === "actor_not_job_seeker"
    );
    expect(blockedAudits.length).toBeGreaterThan(0);
  });

  it("records a browser_submit_blocked audit when submit is rejected for a missing approval audit", async () => {
    const { readySession } = await setupReadySession();
    clearBlockingPauses(readySession.id);
    const approved = approveBrowserSubmit(currentSession, readySession.id, {
      actorUserId: currentSession.userId,
      approvedByUser: true
    });

    const submit = vi.fn(async () => ({ submitted: true }));
    await expect(
      submitApprovedBrowserApplication(
        currentSession,
        approved.session.id,
        { name: "test-adapter", runDetection: vi.fn(), submit },
        { actorUserId: currentSession.userId }
      )
    ).rejects.toThrow("persisted approval audit");

    const audits = loadAuditLogs(currentSession);
    const blocked = audits.find(
      (log) =>
        log.action === "browser_submit_blocked" &&
        log.metadata.reason === "missing_or_invalid_approval_audit"
    );
    expect(blocked).toBeTruthy();
    expect(blocked?.metadata.applicationPackageId).toBe(
      approved.session.applicationPackageId
    );
    expect(submit).not.toHaveBeenCalled();
    expect(loadApplications(currentSession)[0].status).toBe("approved");
  });

  it("forces manual_required when captcha or login pause is still present at submit", async () => {
    const { readySession } = await setupReadySession();
    expect(
      readySession.uncertainFields.some((field) => field.reason === "captcha")
    ).toBe(true);
    const approved = approveBrowserSubmit(currentSession, readySession.id, {
      actorUserId: currentSession.userId,
      approvedByUser: true
    });
    persistAuditEvents(approved.auditEvents);

    const submit = vi.fn(async () => ({ submitted: true }));
    const result = await submitApprovedBrowserApplication(
      currentSession,
      approved.session.id,
      { name: "test-adapter", runDetection: vi.fn(), submit },
      { actorUserId: currentSession.userId }
    );

    expect(submit).not.toHaveBeenCalled();
    expect(result.session.status).toBe("manual_required");
    expect(loadApplications(currentSession)[0].status).toBe("approved");

    const blocked = loadAuditLogs(currentSession).find(
      (log) =>
        log.action === "browser_submit_blocked" &&
        log.metadata.reason === "captcha_or_login_pause_present"
    );
    expect(blocked).toBeTruthy();
  });

  it("marks the session failed and keeps the application approved when the adapter throws", async () => {
    const { readySession } = await setupReadySession();
    clearBlockingPauses(readySession.id);
    const approved = approveBrowserSubmit(currentSession, readySession.id, {
      actorUserId: currentSession.userId,
      approvedByUser: true
    });
    persistAuditEvents(approved.auditEvents);

    const submit = vi.fn(async () => {
      throw new Error("network unreachable");
    });
    const result = await submitApprovedBrowserApplication(
      currentSession,
      approved.session.id,
      { name: "test-adapter", runDetection: vi.fn(), submit },
      { actorUserId: currentSession.userId }
    );

    expect(result.session.status).toBe("failed");
    expect(loadApplications(currentSession)[0].status).toBe("approved");

    const blocked = loadAuditLogs(currentSession).find(
      (log) =>
        log.action === "browser_submit_blocked" &&
        log.metadata.reason === "adapter_submit_threw"
    );
    expect(blocked).toBeTruthy();
  });

  it("blocks submit when fillMode is dry_run and never calls the adapter", async () => {
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
    clearBlockingPauses(started.session.id);

    saveBrowserApplicationSessions(
      currentSession,
      loadBrowserApplicationSessions(currentSession).map((item) =>
        item.id === started.session.id
          ? { ...item, status: "approved_for_submit" as const, fillMode: "dry_run" as const }
          : item
      )
    );
    persistAuditEvents([
      {
        action: "user_approved_browser_submit",
        resourceType: "BrowserApplicationSession",
        resourceId: started.session.id,
        metadata: {
          jobId: started.session.jobId,
          applicationRecordId: started.session.applicationRecordId,
          applicationPackageId: started.session.applicationPackageId,
          approvedFromStatus: "ready_for_review",
          approvedByUserId: currentSession.userId
        }
      }
    ]);

    const submit = vi.fn(async () => ({ submitted: true }));
    await expect(
      submitApprovedBrowserApplication(
        currentSession,
        started.session.id,
        { name: "test-adapter", runDetection: vi.fn(), submit },
        { actorUserId: currentSession.userId }
      )
    ).rejects.toThrow("submit_after_approval");
    expect(submit).not.toHaveBeenCalled();

    const blocked = loadAuditLogs(currentSession).find(
      (log) =>
        log.action === "browser_submit_blocked" &&
        log.metadata.reason === "fill_mode_not_submit_after_approval"
    );
    expect(blocked).toBeTruthy();
    expect(loadApplications(currentSession)[0].status).toBe("approved");
  });

  it("blocks submit when fillMode is fill_only and never calls the adapter", async () => {
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
    clearBlockingPauses(started.session.id);

    saveBrowserApplicationSessions(
      currentSession,
      loadBrowserApplicationSessions(currentSession).map((item) =>
        item.id === started.session.id
          ? { ...item, status: "approved_for_submit" as const, fillMode: "fill_only" as const }
          : item
      )
    );
    persistAuditEvents([
      {
        action: "user_approved_browser_submit",
        resourceType: "BrowserApplicationSession",
        resourceId: started.session.id,
        metadata: {
          jobId: started.session.jobId,
          applicationRecordId: started.session.applicationRecordId,
          applicationPackageId: started.session.applicationPackageId,
          approvedFromStatus: "ready_for_review",
          approvedByUserId: currentSession.userId
        }
      }
    ]);

    const submit = vi.fn(async () => ({ submitted: true }));
    await expect(
      submitApprovedBrowserApplication(
        currentSession,
        started.session.id,
        { name: "test-adapter", runDetection: vi.fn(), submit },
        { actorUserId: currentSession.userId }
      )
    ).rejects.toThrow("submit_after_approval");
    expect(submit).not.toHaveBeenCalled();
    expect(loadApplications(currentSession)[0].status).toBe("approved");
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
