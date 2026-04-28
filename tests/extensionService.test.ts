import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { currentSession } from "../src/data/currentSession";
import type {
  AuditLog,
  ExtensionPageStructure,
  ExtensionSession
} from "../src/models/domain";
import { appendAuditLog, loadAuditLogs } from "../src/services/auditLog";
import {
  approveExtensionFill,
  approveExtensionSubmit,
  authorizeExtensionSession,
  createExtensionFillPlan,
  createExtensionSession,
  disconnectExtensionSession,
  getExtensionSession,
  getExtensionSessionForBrowserSession,
  ingestExtensionPageStructure,
  isExtensionSubmitAllowed,
  loadExtensionSessions,
  markExtensionManualRequired,
  recordExtensionFieldsFilled,
  recordExtensionSubmitCompleted,
  saveExtensionSessions,
  type ExtensionAuditEvent
} from "../src/services/extensionService";
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

function persistAuditEvents(events: ExtensionAuditEvent[]) {
  events.forEach((event) =>
    appendAuditLog(currentSession, {
      action: event.action,
      resourceType: event.resourceType,
      resourceId: event.resourceId,
      metadata: event.metadata
    })
  );
}

function writeAuditLogsDirectly(logs: AuditLog[]) {
  const key = scopedKey(currentSession.tenant.id, currentSession.userId, "audit_logs");
  window.localStorage.setItem(key, JSON.stringify(logs));
}

function basicConnectionRequest(overrides: Record<string, unknown> = {}) {
  return {
    extensionInstanceId: "demo_instance",
    pageUrl: "https://demo.example/jobs/123",
    pageTitle: "Demo Job — Example",
    hostname: "demo.example",
    applicationPackageId: null,
    applicationRecordId: null,
    jobId: null,
    browserApplicationSessionId: null,
    ...overrides
  };
}

function basicPageStructure(overrides: Partial<ExtensionPageStructure> = {}): ExtensionPageStructure {
  return {
    pageUrl: "https://demo.example/jobs/123",
    pageTitle: "Demo Job — Example",
    hostname: "demo.example",
    hasSubmitButton: true,
    hasCaptcha: false,
    hasLoginChallenge: false,
    capturedAt: new Date().toISOString(),
    fields: [
      {
        fieldId: "first_name",
        label: "First name",
        fieldType: "text",
        inputName: "first_name",
        inputId: "first_name",
        placeholder: "",
        required: true,
        sensitive: false,
        hasValue: false
      },
      {
        fieldId: "email",
        label: "Email",
        fieldType: "email",
        inputName: "email",
        inputId: "email",
        placeholder: "",
        required: true,
        sensitive: false,
        hasValue: false
      },
      {
        fieldId: "resume",
        label: "Resume",
        fieldType: "file",
        inputName: "resume",
        inputId: "resume",
        placeholder: "",
        required: true,
        sensitive: false,
        hasValue: false
      },
      {
        fieldId: "eeoc_gender",
        label: "Gender (voluntary demographic question)",
        fieldType: "select",
        inputName: "eeoc_gender",
        inputId: "eeoc_gender",
        placeholder: "",
        required: false,
        sensitive: true,
        hasValue: false
      }
    ],
    ...overrides
  };
}

async function setupReadyForFinalReview(): Promise<{ session: ExtensionSession }> {
  const created = createExtensionSession(currentSession, basicConnectionRequest());
  const sessionId = created.session.id;
  authorizeExtensionSession(currentSession, sessionId, {
    actorUserId: currentSession.userId,
    authorizedByUser: true
  });
  ingestExtensionPageStructure(currentSession, sessionId, basicPageStructure());
  createExtensionFillPlan(currentSession, sessionId);
  approveExtensionFill(currentSession, sessionId, {
    actorUserId: currentSession.userId,
    approvedByUser: true
  });
  const filled = recordExtensionFieldsFilled(currentSession, sessionId, ["first_name", "email"]);
  return { session: filled.session };
}

describe("extensionService", () => {
  beforeEach(() => {
    installLocalStorageMock();
  });

  afterEach(() => {
    Reflect.deleteProperty(globalThis, "window");
  });

  it("creates a new session in awaiting_user_authorization", () => {
    const result = createExtensionSession(currentSession, basicConnectionRequest());
    expect(result.session.status).toBe("awaiting_user_authorization");
    expect(result.session.tenantId).toBe(currentSession.tenant.id);
    expect(result.session.userId).toBe(currentSession.userId);
    expect(result.auditEvents.map((event) => event.action)).toContain(
      "extension_connection_requested"
    );
  });

  it("requires explicit user authorization to move to connected", () => {
    const created = createExtensionSession(currentSession, basicConnectionRequest());
    expect(() =>
      authorizeExtensionSession(currentSession, created.session.id, {
        actorUserId: "coach_user",
        authorizedByUser: true
      })
    ).toThrow("Only the job seeker");

    expect(() =>
      authorizeExtensionSession(currentSession, created.session.id, {
        actorUserId: currentSession.userId,
        authorizedByUser: false
      })
    ).toThrow("Explicit user authorization");

    const authorized = authorizeExtensionSession(currentSession, created.session.id, {
      actorUserId: currentSession.userId,
      authorizedByUser: true
    });
    expect(authorized.session.status).toBe("connected");
  });

  it("ingests a page structure and creates a fill plan that pauses sensitive demographic fields", () => {
    const created = createExtensionSession(currentSession, basicConnectionRequest());
    authorizeExtensionSession(currentSession, created.session.id, {
      actorUserId: currentSession.userId,
      authorizedByUser: true
    });
    const ingested = ingestExtensionPageStructure(
      currentSession,
      created.session.id,
      basicPageStructure()
    );
    expect(ingested.session.status).toBe("page_analyzed");
    expect(ingested.session.fieldsDetected.length).toBeGreaterThan(0);

    const planned = createExtensionFillPlan(currentSession, created.session.id);
    expect(planned.session.status).toBe("fill_plan_ready");
    expect(planned.session.uncertainFields.some((field) => field.reason === "demographic")).toBe(
      true
    );
    expect(
      planned.session.fillPlan.some(
        (item) =>
          (item.action === "fill" || item.action === "upload") &&
          item.label.toLowerCase().includes("gender")
      )
    ).toBe(false);
  });

  it("routes the session to manual_required when CAPTCHA is detected at fill plan time", () => {
    const created = createExtensionSession(currentSession, basicConnectionRequest());
    authorizeExtensionSession(currentSession, created.session.id, {
      actorUserId: currentSession.userId,
      authorizedByUser: true
    });
    ingestExtensionPageStructure(
      currentSession,
      created.session.id,
      basicPageStructure({ hasCaptcha: true })
    );
    const planned = createExtensionFillPlan(currentSession, created.session.id);
    expect(planned.session.status).toBe("manual_required");
  });

  it("requires the job seeker to approve fill", async () => {
    const created = createExtensionSession(currentSession, basicConnectionRequest());
    authorizeExtensionSession(currentSession, created.session.id, {
      actorUserId: currentSession.userId,
      authorizedByUser: true
    });
    ingestExtensionPageStructure(currentSession, created.session.id, basicPageStructure());
    createExtensionFillPlan(currentSession, created.session.id);

    expect(() =>
      approveExtensionFill(currentSession, created.session.id, {
        actorUserId: "coach_user",
        approvedByUser: true
      })
    ).toThrow("Only the job seeker");

    const approved = approveExtensionFill(currentSession, created.session.id, {
      actorUserId: currentSession.userId,
      approvedByUser: true
    });
    expect(approved.session.status).toBe("fill_approved");
  });

  it("blocks submit completion before approval and emits an extension_submit_blocked audit", async () => {
    const { session } = await setupReadyForFinalReview();
    expect(session.status).toBe("ready_for_final_review");

    expect(() =>
      recordExtensionSubmitCompleted(currentSession, session.id, {
        actorUserId: currentSession.userId,
        confirmationDetected: true
      })
    ).toThrow("explicit user approval");

    const blocked = loadAuditLogs(currentSession).find(
      (log) =>
        log.action === "extension_submit_blocked" &&
        log.metadata.reason === "session_not_submit_approved"
    );
    expect(blocked).toBeTruthy();
  });

  it("blocks submit completion when approval audit was authored by a different user", async () => {
    const { session } = await setupReadyForFinalReview();
    const approved = approveExtensionSubmit(currentSession, session.id, {
      actorUserId: currentSession.userId,
      approvedByUser: true
    });
    writeAuditLogsDirectly([
      {
        id: "audit_forged",
        tenantId: currentSession.tenant.id,
        actorUserId: "coach_user",
        action: "user_approved_extension_submit",
        resourceType: "ExtensionSession",
        resourceId: approved.session.id,
        metadata: {
          approvedByUserId: "coach_user",
          approvedFromStatus: "ready_for_final_review"
        },
        createdAt: new Date().toISOString()
      }
    ]);

    expect(() =>
      recordExtensionSubmitCompleted(currentSession, approved.session.id, {
        actorUserId: currentSession.userId,
        confirmationDetected: true
      })
    ).toThrow("persisted approval audit");
  });

  it("blocks submit completion when actor is not the job seeker", async () => {
    const { session } = await setupReadyForFinalReview();
    const approved = approveExtensionSubmit(currentSession, session.id, {
      actorUserId: currentSession.userId,
      approvedByUser: true
    });
    persistAuditEvents(approved.auditEvents);

    expect(() =>
      recordExtensionSubmitCompleted(currentSession, approved.session.id, {
        actorUserId: "coach_user",
        confirmationDetected: true
      })
    ).toThrow("Only the job seeker");

    const blocked = loadAuditLogs(currentSession).find(
      (log) =>
        log.action === "extension_submit_blocked" &&
        log.metadata.reason === "actor_not_job_seeker"
    );
    expect(blocked).toBeTruthy();
  });

  it("blocks submit completion when the linked application package is no longer approved", async () => {
    const created = createExtensionSession(
      currentSession,
      basicConnectionRequest({
        applicationPackageId: "pkg_linked",
        applicationRecordId: "app_linked",
        jobId: "job_linked"
      })
    );
    authorizeExtensionSession(currentSession, created.session.id, {
      actorUserId: currentSession.userId,
      authorizedByUser: true
    });
    ingestExtensionPageStructure(currentSession, created.session.id, basicPageStructure());
    createExtensionFillPlan(currentSession, created.session.id);
    approveExtensionFill(currentSession, created.session.id, {
      actorUserId: currentSession.userId,
      approvedByUser: true
    });
    recordExtensionFieldsFilled(currentSession, created.session.id, ["first_name", "email"]);
    const approved = approveExtensionSubmit(currentSession, created.session.id, {
      actorUserId: currentSession.userId,
      approvedByUser: true
    });
    persistAuditEvents(approved.auditEvents);

    expect(() =>
      recordExtensionSubmitCompleted(currentSession, approved.session.id, {
        actorUserId: currentSession.userId,
        confirmationDetected: true,
        applicationPackage: {
          id: "pkg_linked",
          tenantId: currentSession.tenant.id,
          userId: currentSession.userId,
          jobId: "job_linked",
          applicationRecordId: "app_linked",
          status: "ready_for_review",
          resumeMarkdown: "",
          coverLetter: "",
          coverLetterIncluded: false,
          generationMode: "deterministic",
          modelName: "demo",
          promptVersion: "demo",
          inputHash: "demo",
          outputHash: "demo",
          safetyWarnings: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          approvedAt: null,
          rejectedAt: null
        }
      })
    ).toThrow("no longer approved");

    const blocked = loadAuditLogs(currentSession).find(
      (log) =>
        log.action === "extension_submit_blocked" &&
        log.metadata.reason === "linked_package_not_approved"
    );
    expect(blocked).toBeTruthy();
  });

  it("forces manual_required when captcha pause is still present at submit completion time", async () => {
    const { session } = await setupReadyForFinalReview();
    const approved = approveExtensionSubmit(currentSession, session.id, {
      actorUserId: currentSession.userId,
      approvedByUser: true
    });
    persistAuditEvents(approved.auditEvents);

    saveExtensionSessions(
      currentSession,
      loadExtensionSessions(currentSession).map((item) =>
        item.id === approved.session.id
          ? {
              ...item,
              uncertainFields: [
                {
                  fieldId: "captcha_field",
                  label: "CAPTCHA",
                  reason: "captcha",
                  required: true,
                  guidance: "Solve the CAPTCHA manually."
                }
              ]
            }
          : item
      )
    );

    const result = recordExtensionSubmitCompleted(currentSession, approved.session.id, {
      actorUserId: currentSession.userId,
      confirmationDetected: true
    });
    expect(result.session.status).toBe("manual_required");

    const blocked = loadAuditLogs(currentSession).find(
      (log) =>
        log.action === "extension_submit_blocked" &&
        log.metadata.reason === "captcha_or_login_pause_present"
    );
    expect(blocked).toBeTruthy();
  });

  it("returns manual_required when extension reports submit was not confirmed", async () => {
    const { session } = await setupReadyForFinalReview();
    const approved = approveExtensionSubmit(currentSession, session.id, {
      actorUserId: currentSession.userId,
      approvedByUser: true
    });
    persistAuditEvents(approved.auditEvents);

    const result = recordExtensionSubmitCompleted(currentSession, approved.session.id, {
      actorUserId: currentSession.userId,
      confirmationDetected: false
    });

    expect(result.session.status).toBe("manual_required");
    const blocked = loadAuditLogs(currentSession).find(
      (log) =>
        log.action === "extension_submit_blocked" &&
        log.metadata.reason === "submit_not_confirmed"
    );
    expect(blocked).toBeTruthy();
  });

  it("walks through the full happy path to submitted status when all conditions are satisfied", async () => {
    const { session } = await setupReadyForFinalReview();
    const approved = approveExtensionSubmit(currentSession, session.id, {
      actorUserId: currentSession.userId,
      approvedByUser: true
    });
    persistAuditEvents(approved.auditEvents);

    const result = recordExtensionSubmitCompleted(currentSession, approved.session.id, {
      actorUserId: currentSession.userId,
      confirmationDetected: true
    });
    expect(result.session.status).toBe("submitted");
    expect(result.auditEvents.map((event) => event.action)).toContain(
      "extension_submit_completed"
    );
  });

  it("supports manual fallback and disconnect transitions", async () => {
    const created = createExtensionSession(currentSession, basicConnectionRequest());
    const manual = markExtensionManualRequired(currentSession, created.session.id);
    expect(manual.session.status).toBe("manual_required");

    const disconnected = disconnectExtensionSession(currentSession, created.session.id);
    expect(disconnected.session.status).toBe("disconnected");
  });

  it("isExtensionSubmitAllowed returns false unless every gate is satisfied", () => {
    const created = createExtensionSession(currentSession, basicConnectionRequest());
    expect(isExtensionSubmitAllowed(created.session)).toBe(false);

    saveExtensionSessions(currentSession, [
      {
        ...created.session,
        status: "submit_approved"
      }
    ]);
    const approved = getExtensionSession(currentSession, created.session.id);
    expect(approved && isExtensionSubmitAllowed(approved)).toBe(true);

    saveExtensionSessions(currentSession, [
      {
        ...created.session,
        status: "submit_approved",
        uncertainFields: [
          {
            fieldId: "captcha",
            label: "CAPTCHA",
            reason: "captcha",
            required: true,
            guidance: "Manual"
          }
        ]
      }
    ]);
    const withCaptcha = getExtensionSession(currentSession, created.session.id);
    expect(withCaptcha && isExtensionSubmitAllowed(withCaptcha)).toBe(false);
  });

  it("getExtensionSessionForBrowserSession returns the most recent session linked to the browser session", () => {
    createExtensionSession(
      currentSession,
      basicConnectionRequest({ browserApplicationSessionId: "browser_1" })
    );
    const created2 = createExtensionSession(
      currentSession,
      basicConnectionRequest({ browserApplicationSessionId: "browser_1" })
    );
    const found = getExtensionSessionForBrowserSession(currentSession, "browser_1");
    expect(found?.id).toBe(created2.session.id);
  });
});
