import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { currentSession } from "../src/data/currentSession";
import type { ExtensionSession } from "../src/models/domain";
import {
  compareSnapshots,
  createDryRunSnapshot,
  exportSnapshotJson,
  latestSnapshotForUrl,
  loadDryRunSnapshots,
  recordSnapshotExport,
  redactString,
  redactUrl,
  summarizeValidationStatus
} from "../src/services/realSiteDryRunService";
import { loadAuditLogs } from "../src/services/auditLog";

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

function makeExtensionSession(overrides: Partial<ExtensionSession> = {}): ExtensionSession {
  const now = new Date().toISOString();
  return {
    id: "ext_test",
    tenantId: currentSession.tenant.id,
    userId: currentSession.userId,
    extensionInstanceId: "test_instance",
    pageUrl: "https://boards.greenhouse.io/example/jobs/123",
    pageTitle: "Test Job",
    hostname: "boards.greenhouse.io",
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
    authorizedAt: now,
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

describe("realSiteDryRunService", () => {
  beforeEach(() => installLocalStorageMock());
  afterEach(() => Reflect.deleteProperty(globalThis, "window"));

  describe("redactString", () => {
    it("redacts email-like values", () => {
      expect(redactString("alice@example.com")).toBe("[redacted-email]");
      expect(redactString("Alice.Doe+filter@sub.example.co.uk")).toBe("[redacted-email]");
    });

    it("redacts phone-like values", () => {
      expect(redactString("+1 (555) 010-9876")).toBe("[redacted-phone]");
      expect(redactString("555-0100")).toBe("[redacted-phone]");
    });

    it("redacts opaque token-like values", () => {
      expect(redactString("abcdef0123456789abcdef0123456789")).toBe("[redacted-token]");
      expect(redactString("eyJhbGciOiJIUzI1NiJ9.abcdefghij")).toBe("[redacted-token]");
    });

    it("does not over-redact short or natural strings", () => {
      expect(redactString("Senior PM")).toBe("Senior PM");
      expect(redactString("Acme")).toBe("Acme");
      expect(redactString("")).toBe("");
    });
  });

  describe("redactUrl", () => {
    it("redacts token-like query params by name", () => {
      const redacted = redactUrl(
        "https://boards.greenhouse.io/example/jobs/123?token=ABCDEF1234567890&api_key=keyABC&code=oauth_response_code_value_12345"
      );
      expect(redacted).toContain("[redacted-token]");
      expect(redacted).not.toContain("ABCDEF1234567890");
      expect(redacted).not.toContain("keyABC");
      expect(redacted).not.toContain("oauth_response_code_value_12345");
    });

    it("redacts sensitive value params (email, phone)", () => {
      const redacted = redactUrl(
        "https://boards.greenhouse.io/example/jobs/123?email=jane@example.com&phone=555-0100"
      );
      expect(redacted).toContain("[redacted-value]");
      expect(redacted).not.toContain("jane@example.com");
      expect(redacted).not.toContain("555-0100");
    });

    it("redacts opaque tokens that appear in unknown params", () => {
      const redacted = redactUrl(
        "https://boards.greenhouse.io/example/jobs/123?session_id=abcdef1234567890abcdef1234567890"
      );
      expect(redacted).not.toContain("abcdef1234567890abcdef1234567890");
      expect(redacted).toContain("[redacted-token]");
    });

    it("strips credentials and fragments", () => {
      const redacted = redactUrl(
        "https://user:secret@boards.greenhouse.io/example/jobs/123#tokenfragment"
      );
      expect(redacted).not.toContain("user:secret");
      expect(redacted).not.toContain("secret");
      expect(redacted).not.toContain("tokenfragment");
    });

    it("returns [invalid-url] for unparseable input", () => {
      expect(redactUrl("not a url")).toBe("[invalid-url]");
    });

    it("preserves benign query params untouched", () => {
      const redacted = redactUrl(
        "https://boards.greenhouse.io/example/jobs/123?source=linkedin&utm_campaign=summer"
      );
      expect(redacted).toContain("source=linkedin");
      expect(redacted).toContain("utm_campaign=summer");
    });
  });

  describe("createDryRunSnapshot", () => {
    it("rejects empty URLs and emits a blocked validation audit", () => {
      expect(() =>
        createDryRunSnapshot(currentSession, { sourceUrl: "" })
      ).toThrow("source URL is required");
      const audits = loadAuditLogs(currentSession);
      expect(
        audits.some(
          (log) =>
            log.action === "real_site_validation_blocked" &&
            log.metadata.reason === "missing_source_url"
        )
      ).toBe(true);
    });

    it("rejects unsupported schemes", () => {
      expect(() =>
        createDryRunSnapshot(currentSession, { sourceUrl: "ftp://example.com" })
      ).toThrow("Only http and https URLs are supported.");
      const audits = loadAuditLogs(currentSession);
      expect(
        audits.some(
          (log) =>
            log.action === "real_site_validation_blocked" &&
            log.metadata.reason === "unsupported_scheme"
        )
      ).toBe(true);
    });

    it("creates a Greenhouse snapshot with submit always blocked", () => {
      const result = createDryRunSnapshot(currentSession, {
        sourceUrl: "https://boards.greenhouse.io/example/jobs/123"
      });
      expect(result.snapshot.atsType).toBe("greenhouse");
      expect(result.snapshot.adapterConfidence).toBeGreaterThanOrEqual(0.8);
      expect(result.snapshot.submitBlocked).toBe(true);
      expect(result.snapshot.validationSummary.submitBlocked).toBe(true);
      expect(result.snapshot.source).toBe("url_only");
      expect(result.snapshot.extensionSessionId).toBeNull();
      expect(result.auditEvents.map((event) => event.action)).toEqual([
        "real_site_dry_run_requested",
        "real_site_page_analyzed",
        "real_site_snapshot_saved"
      ]);
    });

    it("creates a Lever snapshot when given a Lever URL", () => {
      const result = createDryRunSnapshot(currentSession, {
        sourceUrl: "https://jobs.lever.co/example/abc"
      });
      expect(result.snapshot.atsType).toBe("lever");
      expect(result.snapshot.adapterConfidence).toBeGreaterThanOrEqual(0.8);
      expect(result.snapshot.submitBlocked).toBe(true);
    });

    it("falls back to unknown for non-ATS hostnames", () => {
      const result = createDryRunSnapshot(currentSession, {
        sourceUrl: "https://careers.example.com/jobs/abc"
      });
      expect(result.snapshot.atsType).toBe("unknown");
      expect(result.snapshot.submitBlocked).toBe(true);
    });

    it("incorporates extension session counts when provided", () => {
      const ext = makeExtensionSession({
        fieldsDetected: [
          {
            id: "greenhouse_first_name",
            label: "First name",
            fieldType: "text",
            required: true,
            sensitive: false,
            confidence: 0.93,
            source: "profile",
            sourceField: "fullName"
          },
          {
            id: "greenhouse_eeoc_gender",
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
            fieldId: "greenhouse_first_name",
            label: "First name",
            action: "fill",
            source: "profile",
            sourceField: "fullName",
            valuePreview: "Saved profile field: fullName",
            confidence: 0.93,
            reason: ""
          },
          {
            fieldId: "greenhouse_eeoc_gender",
            label: "Gender",
            action: "pause",
            source: "user_required",
            sourceField: "demographic defaults",
            valuePreview: "User review required",
            confidence: 0.18,
            reason: "Voluntary demographic question."
          }
        ],
        uncertainFields: [
          {
            fieldId: "greenhouse_eeoc_gender",
            label: "Gender",
            reason: "demographic",
            required: false,
            guidance: "Voluntary demographic question."
          }
        ]
      });
      const result = createDryRunSnapshot(currentSession, {
        sourceUrl: "https://boards.greenhouse.io/example/jobs/777",
        extensionSession: ext
      });
      expect(result.snapshot.detectedFieldCount).toBe(2);
      expect(result.snapshot.requiredFieldCount).toBe(1);
      expect(result.snapshot.sensitiveFieldCount).toBe(1);
      expect(result.snapshot.pausedFieldCount).toBe(1);
      expect(result.snapshot.safeFillCount).toBe(1);
      expect(result.snapshot.source).toBe("extension_session");
      expect(result.snapshot.extensionSessionId).toBe(ext.id);
      expect(result.snapshot.validationSummary.sensitiveFieldsPaused).toBe(true);
      expect(result.snapshot.validationSummary.requiredFieldsFound).toBe(true);
      expect(result.snapshot.submitBlocked).toBe(true);
    });

    it("never includes the raw token in the snapshot's redacted URL", () => {
      const result = createDryRunSnapshot(currentSession, {
        sourceUrl:
          "https://boards.greenhouse.io/example/jobs/123?token=secret_token_value_with_length"
      });
      expect(result.snapshot.redactedUrl).not.toContain("secret_token_value_with_length");
      expect(result.snapshot.redactedUrl).toContain("[redacted-token]");
      expect(result.snapshot.sourceUrl).toBe(result.snapshot.redactedUrl);
    });

    it("computes a comparison when a previous snapshot exists for the same hostname", () => {
      const first = createDryRunSnapshot(currentSession, {
        sourceUrl: "https://boards.greenhouse.io/example/jobs/A"
      });
      expect(first.comparison).toBeNull();

      const ext = makeExtensionSession({
        hostname: "boards.greenhouse.io",
        fieldsDetected: [
          {
            id: "greenhouse_first_name",
            label: "First name",
            fieldType: "text",
            required: true,
            sensitive: false,
            confidence: 0.93,
            source: "profile",
            sourceField: "fullName"
          }
        ],
        fillPlan: [
          {
            fieldId: "greenhouse_first_name",
            label: "First name",
            action: "fill",
            source: "profile",
            sourceField: "fullName",
            valuePreview: "Saved profile field: fullName",
            confidence: 0.93,
            reason: ""
          }
        ]
      });
      const second = createDryRunSnapshot(currentSession, {
        sourceUrl: "https://boards.greenhouse.io/example/jobs/B",
        extensionSession: ext
      });
      expect(second.comparison?.previousSnapshotId).toBe(first.snapshot.id);
      expect(second.comparison?.detectedFieldDelta).toBe(1);
      expect(second.comparison?.safeFillDelta).toBe(1);
      expect(second.comparison?.submitStillBlocked).toBe(true);
    });
  });

  describe("compareSnapshots", () => {
    it("computes deltas between two snapshots", () => {
      const a = createDryRunSnapshot(currentSession, {
        sourceUrl: "https://boards.greenhouse.io/example/jobs/A"
      }).snapshot;
      const b = createDryRunSnapshot(currentSession, {
        sourceUrl: "https://jobs.lever.co/example/B",
        extensionSession: makeExtensionSession({
          hostname: "jobs.lever.co",
          fieldsDetected: [
            {
              id: "lever_name",
              label: "Name",
              fieldType: "text",
              required: true,
              sensitive: false,
              confidence: 0.95,
              source: "profile",
              sourceField: "fullName"
            }
          ]
        })
      }).snapshot;
      const cmp = compareSnapshots(a, b);
      expect(cmp.adapterChanged).toBe(true);
      expect(cmp.detectedFieldDelta).toBe(1 - a.detectedFieldCount);
      expect(cmp.submitStillBlocked).toBe(true);
    });
  });

  describe("latestSnapshotForUrl", () => {
    it("returns the most recent snapshot for a hostname", () => {
      const a = createDryRunSnapshot(currentSession, {
        sourceUrl: "https://boards.greenhouse.io/example/jobs/A"
      }).snapshot;
      const b = createDryRunSnapshot(currentSession, {
        sourceUrl: "https://boards.greenhouse.io/example/jobs/B"
      }).snapshot;
      const all = loadDryRunSnapshots(currentSession);
      const latest = latestSnapshotForUrl(all, "boards.greenhouse.io");
      expect(latest?.id).toBe(b.id);
      expect(a.id).not.toBe(b.id);
    });

    it("returns null when no snapshot matches", () => {
      const all = loadDryRunSnapshots(currentSession);
      expect(latestSnapshotForUrl(all, "no.such.host")).toBeNull();
    });
  });

  describe("exportSnapshotJson + recordSnapshotExport", () => {
    it("exports a JSON string that does not contain raw tokens or emails", () => {
      const { snapshot } = createDryRunSnapshot(currentSession, {
        sourceUrl:
          "https://boards.greenhouse.io/example/jobs/123?token=shouldnotappearherelongtokenvalue&email=alice@example.com"
      });
      const json = exportSnapshotJson(snapshot);
      expect(json).not.toContain("shouldnotappearherelongtokenvalue");
      expect(json).not.toContain("alice@example.com");
      expect(json).toContain("[redacted-token]");
      expect(json).toContain("[redacted-value]");
    });

    it("emits a real_site_snapshot_exported audit event", () => {
      const { snapshot } = createDryRunSnapshot(currentSession, {
        sourceUrl: "https://boards.greenhouse.io/example/jobs/123"
      });
      const events = recordSnapshotExport(currentSession, snapshot);
      expect(events).toHaveLength(1);
      expect(events[0].action).toBe("real_site_snapshot_exported");
      expect(events[0].resourceId).toBe(snapshot.id);
    });
  });

  describe("summarizeValidationStatus", () => {
    it("counts passed and failed validation checks", () => {
      const summary = summarizeValidationStatus({
        adapterDetectedCorrectly: true,
        requiredFieldsFound: false,
        safeFieldsMapped: true,
        uncertainFieldsPaused: true,
        sensitiveFieldsPaused: true,
        submitBlocked: true
      });
      expect(summary).toEqual({ passed: 5, failed: 1, total: 6 });
    });
  });
});
