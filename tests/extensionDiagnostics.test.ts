import { describe, expect, it } from "vitest";
import { currentSession } from "../src/data/currentSession";
import type {
  ApplicationPackage,
  ExtensionSession
} from "../src/models/domain";
import {
  extensionDiagnostics,
  extensionSafetyStatus,
  extensionSubmitGate,
  isExtensionAuditAction,
  isExtensionUsageEvent,
  latestExtensionSession
} from "../src/services/extensionService";

function makeSession(overrides: Partial<ExtensionSession> = {}): ExtensionSession {
  const now = new Date().toISOString();
  return {
    id: "ext_test_1",
    tenantId: currentSession.tenant.id,
    userId: currentSession.userId,
    extensionInstanceId: "test_instance",
    pageUrl: "https://example.com/jobs/123",
    pageTitle: "Example Job",
    hostname: "example.com",
    status: "fill_plan_ready",
    applicationPackageId: null,
    applicationRecordId: null,
    jobId: null,
    browserApplicationSessionId: null,
    fieldsDetected: [],
    fieldsFilled: [],
    uncertainFields: [],
    fillPlan: [],
    pageStructureHash: "hash",
    authorizedAt: null,
    fillApprovedAt: null,
    submitApprovedAt: null,
    submittedAt: null,
    disconnectedAt: null,
    errorMessage: "",
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

function makePackage(overrides: Partial<ApplicationPackage> = {}): ApplicationPackage {
  const now = new Date().toISOString();
  return {
    id: "pkg_test",
    tenantId: currentSession.tenant.id,
    userId: currentSession.userId,
    jobId: "job_test",
    applicationRecordId: "app_test",
    status: "approved",
    resumeMarkdown: "",
    coverLetter: "",
    generationMode: "deterministic",
    modelName: "test",
    promptVersion: "test",
    inputHash: "in",
    outputHash: "out",
    safetyWarnings: [],
    createdAt: now,
    updatedAt: now,
    approvedAt: now,
    rejectedAt: null,
    ...overrides
  };
}

describe("extension diagnostics", () => {
  describe("latestExtensionSession", () => {
    it("returns null when no sessions exist", () => {
      expect(latestExtensionSession([])).toBeNull();
    });

    it("returns the most recently updated session", () => {
      const older = makeSession({
        id: "older",
        updatedAt: "2026-04-20T00:00:00.000Z"
      });
      const newer = makeSession({
        id: "newer",
        updatedAt: "2026-04-25T00:00:00.000Z"
      });
      expect(latestExtensionSession([older, newer])?.id).toBe("newer");
      expect(latestExtensionSession([newer, older])?.id).toBe("newer");
    });
  });

  describe("extensionSafetyStatus", () => {
    it("declares safe defaults that match the documented contract", () => {
      expect(extensionSafetyStatus.liveSubmit).toBe("disabled");
      expect(extensionSafetyStatus.defaultMode).toBe("dry_run");
      expect(extensionSafetyStatus.captchaBypass).toBe("disabled");
      expect(extensionSafetyStatus.credentialCapture).toBe("disabled");
      expect(extensionSafetyStatus.sensitiveAutofill).toBe(
        "disabled_unless_user_defaults"
      );
    });
  });

  describe("extensionSubmitGate", () => {
    it("blocks when no session exists", () => {
      const gate = extensionSubmitGate(null);
      expect(gate.blocked).toBe(true);
      if (gate.blocked) {
        expect(gate.code).toBe("no_session");
      }
    });

    it("blocks when status is not submit_approved", () => {
      const gate = extensionSubmitGate(makeSession({ status: "fill_plan_ready" }));
      expect(gate.blocked).toBe(true);
      if (gate.blocked) {
        expect(gate.code).toBe("session_not_submit_approved");
      }
    });

    it("blocks when session is disconnected or failed", () => {
      const disconnected = extensionSubmitGate(makeSession({ status: "disconnected" }));
      expect(disconnected.blocked).toBe(true);
      if (disconnected.blocked) {
        expect(disconnected.code).toBe("session_disconnected_or_failed");
      }

      const failed = extensionSubmitGate(makeSession({ status: "failed" }));
      expect(failed.blocked).toBe(true);
      if (failed.blocked) {
        expect(failed.code).toBe("session_disconnected_or_failed");
      }
    });

    it("blocks when linked package is no longer approved", () => {
      const session = makeSession({
        status: "submit_approved",
        applicationPackageId: "pkg_test"
      });
      const pkg = makePackage({ id: "pkg_test", status: "ready_for_review" });
      const gate = extensionSubmitGate(session, pkg);
      expect(gate.blocked).toBe(true);
      if (gate.blocked) {
        expect(gate.code).toBe("linked_package_not_approved");
      }
    });

    it("blocks when linked package id does not match", () => {
      const session = makeSession({
        status: "submit_approved",
        applicationPackageId: "pkg_one"
      });
      const pkg = makePackage({ id: "pkg_other", status: "approved" });
      const gate = extensionSubmitGate(session, pkg);
      expect(gate.blocked).toBe(true);
      if (gate.blocked) {
        expect(gate.code).toBe("linked_package_not_approved");
      }
    });

    it("blocks when captcha pause is still present", () => {
      const session = makeSession({
        status: "submit_approved",
        uncertainFields: [
          {
            fieldId: "captcha",
            label: "CAPTCHA",
            reason: "captcha",
            required: true,
            guidance: "Solve the CAPTCHA manually."
          }
        ]
      });
      const gate = extensionSubmitGate(session);
      expect(gate.blocked).toBe(true);
      if (gate.blocked) {
        expect(gate.code).toBe("captcha_or_login_pause_present");
      }
    });

    it("blocks when login pause is still present", () => {
      const session = makeSession({
        status: "submit_approved",
        uncertainFields: [
          {
            fieldId: "login",
            label: "Login",
            reason: "login_challenge",
            required: true,
            guidance: "Sign in manually."
          }
        ]
      });
      const gate = extensionSubmitGate(session);
      expect(gate.blocked).toBe(true);
      if (gate.blocked) {
        expect(gate.code).toBe("captcha_or_login_pause_present");
      }
    });

    it("allows submit when every gate is satisfied", () => {
      const session = makeSession({
        status: "submit_approved",
        applicationPackageId: "pkg_test"
      });
      const pkg = makePackage({ id: "pkg_test", status: "approved" });
      const gate = extensionSubmitGate(session, pkg);
      expect(gate.blocked).toBe(false);
    });

    it("allows submit on an unlinked session in submit_approved with no captcha pause", () => {
      const session = makeSession({ status: "submit_approved" });
      const gate = extensionSubmitGate(session);
      expect(gate.blocked).toBe(false);
    });
  });

  describe("extensionDiagnostics", () => {
    it("returns the no-session shape when called without a session", () => {
      const diag = extensionDiagnostics(null);
      expect(diag.hasSession).toBe(false);
      expect(diag.status).toBeNull();
      expect(diag.detectedFieldCount).toBe(0);
      expect(diag.fillCount).toBe(0);
      expect(diag.pauseCount).toBe(0);
      expect(diag.submit.blocked).toBe(true);
      if (diag.submit.blocked) {
        expect(diag.submit.code).toBe("no_session");
      }
    });

    it("computes counts and a blocked submit reason for an in-flight session", () => {
      const session = makeSession({
        status: "fill_plan_ready",
        fieldsDetected: [
          {
            id: "first_name",
            label: "First name",
            fieldType: "text",
            required: true,
            sensitive: false,
            confidence: 0.9,
            source: "profile",
            sourceField: "fullName"
          },
          {
            id: "gender",
            label: "Gender",
            fieldType: "select",
            required: false,
            sensitive: true,
            confidence: 0.18,
            source: "user_required",
            sourceField: "demographic defaults"
          }
        ],
        fillPlan: [
          {
            fieldId: "first_name",
            label: "First name",
            action: "fill",
            source: "profile",
            sourceField: "fullName",
            valuePreview: "Saved profile field: fullName",
            confidence: 0.9,
            reason: ""
          },
          {
            fieldId: "gender",
            label: "Gender",
            action: "pause",
            source: "user_required",
            sourceField: "demographic defaults",
            valuePreview: "User review required",
            confidence: 0.18,
            reason: "Voluntary demographic questions require manual input."
          }
        ],
        uncertainFields: [
          {
            fieldId: "gender",
            label: "Gender",
            reason: "demographic",
            required: false,
            guidance: "Voluntary demographic questions require manual input."
          }
        ]
      });

      const diag = extensionDiagnostics(session);
      expect(diag.hasSession).toBe(true);
      expect(diag.status).toBe("fill_plan_ready");
      expect(diag.detectedFieldCount).toBe(2);
      expect(diag.fillPlanCount).toBe(2);
      expect(diag.fillCount).toBe(1);
      expect(diag.pauseCount).toBe(1);
      expect(diag.submit.blocked).toBe(true);
      if (diag.submit.blocked) {
        expect(diag.submit.code).toBe("session_not_submit_approved");
      }
      expect(diag.fillPlan).toHaveLength(2);
      expect(diag.pausedFields).toHaveLength(1);
    });

    it("treats upload actions as planned fills", () => {
      const session = makeSession({
        status: "fill_plan_ready",
        fillPlan: [
          {
            fieldId: "resume",
            label: "Resume",
            action: "upload",
            source: "resume",
            sourceField: "resumeMarkdown",
            valuePreview: "",
            confidence: 0.9,
            reason: ""
          }
        ]
      });
      expect(extensionDiagnostics(session).fillCount).toBe(1);
    });
  });

  describe("event filters", () => {
    it("recognises every documented extension audit action", () => {
      const expected = [
        "extension_connection_requested",
        "extension_connected",
        "application_page_analyzed",
        "fill_plan_created",
        "user_approved_field_fill",
        "extension_fields_filled",
        "user_approved_extension_submit",
        "extension_submit_completed",
        "extension_disconnected",
        "extension_session_failed",
        "extension_manual_required",
        "extension_submit_blocked"
      ];
      expected.forEach((action) => {
        expect(isExtensionAuditAction(action)).toBe(true);
      });
      expect(isExtensionAuditAction("application_submitted")).toBe(false);
      expect(isExtensionAuditAction("browser_session_created")).toBe(false);
    });

    it("recognises every documented extension usage event", () => {
      const expected = [
        "extension_session_started",
        "extension_page_analyzed",
        "extension_fill_plan_created",
        "extension_fields_filled",
        "extension_submit_approved",
        "extension_session_failed"
      ];
      expected.forEach((event) => {
        expect(isExtensionUsageEvent(event)).toBe(true);
      });
      expect(isExtensionUsageEvent("application_submitted")).toBe(false);
      expect(isExtensionUsageEvent("browser_session_started")).toBe(false);
    });
  });
});
