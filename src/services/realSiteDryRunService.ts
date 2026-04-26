import type {
  AppSession,
  AuditLog,
  ExtensionSession,
  RealSiteDryRunSnapshot,
  RealSiteValidationSummary
} from "../models/domain";
import { realSiteDryRunSnapshotSchema } from "../models/schemas";
import { readJson, scopedKey, writeJson } from "../lib/storage";
import { appendAuditLog } from "./auditLog";
import {
  defaultATSAdapters,
  selectATSAdapter,
  type ATSPageSnapshot
} from "./atsAdapters";

type AuditMetadata = AuditLog["metadata"];

/**
 * Phase 11 — Real-site dry-run validation service.
 *
 * - External pages always default to dry_run.
 * - The service never stores field values, cookies, tokens, or credentials.
 * - Snapshots are counts and adapter-level metadata only.
 * - Submit is always blocked for real-site snapshots in this phase.
 */

export interface RealSiteDryRunResult {
  snapshot: RealSiteDryRunSnapshot;
  snapshots: RealSiteDryRunSnapshot[];
  comparison: RealSiteDryRunComparison | null;
  auditEvents: RealSiteAuditEvent[];
}

export interface RealSiteAuditEvent {
  action: string;
  resourceType: string;
  resourceId: string;
  metadata: AuditMetadata;
}

export interface RealSiteDryRunComparison {
  previousSnapshotId: string;
  detectedFieldDelta: number;
  requiredFieldDelta: number;
  pausedFieldDelta: number;
  sensitiveFieldDelta: number;
  safeFillDelta: number;
  adapterChanged: boolean;
  confidenceDelta: number;
  submitStillBlocked: boolean;
}

const TOKEN_PARAM_NAMES = new Set([
  "token",
  "auth",
  "auth_token",
  "access_token",
  "id_token",
  "refresh_token",
  "api_key",
  "apikey",
  "api-key",
  "key",
  "secret",
  "session",
  "sid",
  "ssid",
  "code",
  "state",
  "signature",
  "sig",
  "hmac",
  "hash",
  "csrf",
  "csrf_token",
  "xsrf",
  "nonce",
  "password",
  "pwd"
]);

const SENSITIVE_VALUE_PARAM_NAMES = new Set([
  "email",
  "e-mail",
  "phone",
  "tel",
  "telephone",
  "ssn",
  "dob",
  "first_name",
  "last_name",
  "fullname",
  "full_name"
]);

function looksLikeOpaqueToken(value: string): boolean {
  if (value.length < 20) return false;
  if (/\s/.test(value)) return false;
  // base64-ish or hex-ish or URL-safe random strings
  return /^[A-Za-z0-9_\-=.+/]+$/.test(value);
}

function looksLikeEmail(value: string): boolean {
  return /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(value);
}

function looksLikePhone(value: string): boolean {
  // Must contain at least 7 digits and be mostly digits/punctuation
  const digits = value.replace(/[^0-9]/g, "");
  if (digits.length < 7 || digits.length > 16) return false;
  return /^[+()\d\s\-./]+$/.test(value);
}

function isSensitiveParamName(name: string): boolean {
  return SENSITIVE_VALUE_PARAM_NAMES.has(name.toLowerCase());
}

function isTokenParamName(name: string): boolean {
  return TOKEN_PARAM_NAMES.has(name.toLowerCase());
}

export function redactString(value: string): string {
  if (!value) return value;
  if (looksLikeEmail(value)) return "[redacted-email]";
  if (looksLikePhone(value)) return "[redacted-phone]";
  if (looksLikeOpaqueToken(value)) return "[redacted-token]";
  return value;
}

export function redactUrl(rawUrl: string): string {
  if (!rawUrl) return "";
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return "[invalid-url]";
  }
  // Strip credentials from the URL itself
  url.username = "";
  url.password = "";
  // Drop fragment — sometimes apps stuff tokens there
  if (url.hash) {
    url.hash = "";
  }
  const params = new URLSearchParams(url.search);
  const next = new URLSearchParams();
  params.forEach((value, key) => {
    if (isTokenParamName(key)) {
      next.set(key, "[redacted-token]");
    } else if (isSensitiveParamName(key)) {
      next.set(key, "[redacted-value]");
    } else {
      next.set(key, redactString(value));
    }
  });
  url.search = next.toString();
  return url
    .toString()
    .replace(/%5Bredacted-token%5D/gi, "[redacted-token]")
    .replace(/%5Bredacted-value%5D/gi, "[redacted-value]")
    .replace(/%5Bredacted-email%5D/gi, "[redacted-email]")
    .replace(/%5Bredacted-phone%5D/gi, "[redacted-phone]");
}

function safeHostname(input: string): string {
  if (!input) return "";
  try {
    return new URL(input).hostname;
  } catch {
    return input;
  }
}

function snapshotsKey(session: AppSession): string {
  return scopedKey(session.tenant.id, session.userId, "real_site_dry_run_snapshots");
}

export function loadDryRunSnapshots(
  session: AppSession
): RealSiteDryRunSnapshot[] {
  const snapshots = readJson<RealSiteDryRunSnapshot[]>(snapshotsKey(session), []);
  return snapshots.filter(
    (snapshot) => realSiteDryRunSnapshotSchema.safeParse(snapshot).success
  );
}

export function saveDryRunSnapshots(
  session: AppSession,
  snapshots: RealSiteDryRunSnapshot[]
): RealSiteDryRunSnapshot[] {
  const parsed = snapshots.map((snapshot) =>
    realSiteDryRunSnapshotSchema.parse(snapshot)
  );
  writeJson(snapshotsKey(session), parsed.slice(0, 200));
  return parsed;
}

function event(
  action: string,
  resourceId: string,
  metadata: AuditMetadata = {}
): RealSiteAuditEvent {
  return {
    action,
    resourceType: "RealSiteDryRunSnapshot",
    resourceId,
    metadata
  };
}

function recordBlockedValidation(
  session: AppSession,
  reason: string,
  metadata: AuditMetadata = {}
): void {
  appendAuditLog(session, {
    action: "real_site_validation_blocked",
    resourceType: "RealSiteDryRunSnapshot",
    resourceId: "unknown_snapshot",
    metadata: { reason, ...metadata }
  });
}

function detectedFieldsFromExtension(
  extensionSession: ExtensionSession
): {
  detectedFieldCount: number;
  requiredFieldCount: number;
  safeFillCount: number;
  pausedFieldCount: number;
  sensitiveFieldCount: number;
  submitButtonCount: number;
} {
  const detected = extensionSession.fieldsDetected;
  const requiredFieldCount = detected.filter((field) => field.required).length;
  const sensitiveFieldCount = detected.filter((field) => field.sensitive).length;
  const safeFillCount = extensionSession.fillPlan.filter(
    (item) => item.action === "fill" || item.action === "upload"
  ).length;
  const pausedFieldCount = extensionSession.uncertainFields.length;
  // Submit-button-count is not tracked on the session; assume 1 if any fill plan exists.
  const submitButtonCount = extensionSession.fillPlan.length > 0 ? 1 : 0;
  return {
    detectedFieldCount: detected.length,
    requiredFieldCount,
    safeFillCount,
    pausedFieldCount,
    sensitiveFieldCount,
    submitButtonCount
  };
}

function urlOnlyDetection(url: string): {
  atsType: "greenhouse" | "lever" | "unknown";
  adapterConfidence: number;
} {
  const snapshot: ATSPageSnapshot = { url, html: "", title: "", safeFixture: false };
  const { detection } = selectATSAdapter(snapshot, defaultATSAdapters());
  const type =
    detection.adapterType === "greenhouse" ||
    detection.adapterType === "lever"
      ? detection.adapterType
      : "unknown";
  return { atsType: type, adapterConfidence: detection.confidence };
}

function summarizeValidation(
  snapshot: Omit<
    RealSiteDryRunSnapshot,
    "validationSummary" | "submitBlocked" | "submitBlockedReason"
  >
): RealSiteValidationSummary {
  return {
    adapterDetectedCorrectly:
      snapshot.atsType !== "unknown" && snapshot.adapterConfidence >= 0.6,
    requiredFieldsFound: snapshot.requiredFieldCount > 0,
    safeFieldsMapped: snapshot.safeFillCount > 0,
    uncertainFieldsPaused: snapshot.pausedFieldCount > 0,
    sensitiveFieldsPaused:
      snapshot.sensitiveFieldCount === 0 ||
      snapshot.pausedFieldCount >= snapshot.sensitiveFieldCount,
    submitBlocked: true
  };
}

export interface CreateDryRunSnapshotInput {
  sourceUrl: string;
  pageTitle?: string;
  extensionSession?: ExtensionSession | null;
}

export function createDryRunSnapshot(
  session: AppSession,
  input: CreateDryRunSnapshotInput
): RealSiteDryRunResult {
  const trimmedUrl = (input.sourceUrl || "").trim();
  if (!trimmedUrl) {
    recordBlockedValidation(session, "missing_source_url");
    throw new Error("A source URL is required to create a dry-run snapshot.");
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(trimmedUrl);
  } catch {
    recordBlockedValidation(session, "invalid_source_url", {
      sourceUrlLength: trimmedUrl.length
    });
    throw new Error("The source URL is not a valid URL.");
  }

  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    recordBlockedValidation(session, "unsupported_scheme", {
      scheme: parsedUrl.protocol
    });
    throw new Error("Only http and https URLs are supported.");
  }

  const redactedUrl = redactUrl(trimmedUrl);
  const hostname = parsedUrl.hostname;

  const linkedSession = input.extensionSession ?? null;

  const detection = linkedSession
    ? {
        atsType:
          linkedSession.fieldsDetected.some((field) =>
            field.id.startsWith("greenhouse_")
          )
            ? "greenhouse"
            : linkedSession.fieldsDetected.some((field) =>
                  field.id.startsWith("lever_")
                )
              ? "lever"
              : urlOnlyDetection(trimmedUrl).atsType,
        adapterConfidence:
          linkedSession.fieldsDetected.length > 0
            ? Math.max(0.7, urlOnlyDetection(trimmedUrl).adapterConfidence)
            : urlOnlyDetection(trimmedUrl).adapterConfidence
      }
    : urlOnlyDetection(trimmedUrl);

  const counts = linkedSession
    ? detectedFieldsFromExtension(linkedSession)
    : {
        detectedFieldCount: 0,
        requiredFieldCount: 0,
        safeFillCount: 0,
        pausedFieldCount: 0,
        sensitiveFieldCount: 0,
        submitButtonCount: 0
      };

  const baseSnapshot = {
    id: `dryrun_${globalThis.crypto.randomUUID()}`,
    tenantId: session.tenant.id,
    userId: session.userId,
    sourceUrl: redactedUrl,
    redactedUrl,
    hostname,
    atsType: detection.atsType,
    adapterConfidence: detection.adapterConfidence,
    pageTitle: redactString(linkedSession?.pageTitle ?? input.pageTitle ?? ""),
    detectedFieldCount: counts.detectedFieldCount,
    requiredFieldCount: counts.requiredFieldCount,
    safeFillCount: counts.safeFillCount,
    pausedFieldCount: counts.pausedFieldCount,
    sensitiveFieldCount: counts.sensitiveFieldCount,
    submitButtonCount: counts.submitButtonCount,
    source: linkedSession ? ("extension_session" as const) : ("url_only" as const),
    extensionSessionId: linkedSession?.id ?? null,
    createdAt: new Date().toISOString()
  };

  const validationSummary = summarizeValidation(baseSnapshot);

  const snapshot = realSiteDryRunSnapshotSchema.parse({
    ...baseSnapshot,
    submitBlocked: true,
    submitBlockedReason:
      "Phase 11 disables live external submit; real-site validation is dry-run only.",
    validationSummary
  });

  const previous = latestSnapshotForUrl(loadDryRunSnapshots(session), hostname);
  const comparison = previous ? compareSnapshots(previous, snapshot) : null;

  const snapshots = [snapshot, ...loadDryRunSnapshots(session)];
  saveDryRunSnapshots(session, snapshots);

  const auditEvents: RealSiteAuditEvent[] = [
    event("real_site_dry_run_requested", snapshot.id, {
      hostname,
      atsType: snapshot.atsType,
      source: snapshot.source
    }),
    event("real_site_page_analyzed", snapshot.id, {
      hostname,
      atsType: snapshot.atsType,
      adapterConfidence: Math.round(snapshot.adapterConfidence * 100),
      detectedFieldCount: snapshot.detectedFieldCount
    }),
    event("real_site_snapshot_saved", snapshot.id, {
      hostname,
      atsType: snapshot.atsType,
      submitBlocked: snapshot.submitBlocked
    })
  ];

  return { snapshot, snapshots, comparison, auditEvents };
}

export function latestSnapshotForUrl(
  snapshots: RealSiteDryRunSnapshot[],
  hostnameOrUrl: string
): RealSiteDryRunSnapshot | null {
  if (!hostnameOrUrl) return null;
  const target = safeHostname(hostnameOrUrl) || hostnameOrUrl;
  const matches = snapshots
    .filter((snapshot) => snapshot.hostname === target)
    .sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  return matches[0] ?? null;
}

export function compareSnapshots(
  previous: RealSiteDryRunSnapshot,
  current: RealSiteDryRunSnapshot
): RealSiteDryRunComparison {
  return {
    previousSnapshotId: previous.id,
    detectedFieldDelta: current.detectedFieldCount - previous.detectedFieldCount,
    requiredFieldDelta: current.requiredFieldCount - previous.requiredFieldCount,
    pausedFieldDelta: current.pausedFieldCount - previous.pausedFieldCount,
    sensitiveFieldDelta:
      current.sensitiveFieldCount - previous.sensitiveFieldCount,
    safeFillDelta: current.safeFillCount - previous.safeFillCount,
    adapterChanged: current.atsType !== previous.atsType,
    confidenceDelta: Number(
      (current.adapterConfidence - previous.adapterConfidence).toFixed(2)
    ),
    submitStillBlocked: current.submitBlocked && previous.submitBlocked
  };
}

export function exportSnapshotJson(snapshot: RealSiteDryRunSnapshot): string {
  // Snapshot is constructed redacted by definition; JSON.stringify is safe.
  return JSON.stringify(snapshot, null, 2);
}

export function recordSnapshotExport(
  session: AppSession,
  snapshot: RealSiteDryRunSnapshot
): RealSiteAuditEvent[] {
  return [
    event("real_site_snapshot_exported", snapshot.id, {
      hostname: snapshot.hostname,
      atsType: snapshot.atsType,
      submitBlocked: snapshot.submitBlocked
    })
  ];
}

export function summarizeValidationStatus(
  summary: RealSiteValidationSummary
): { passed: number; failed: number; total: number } {
  const items = Object.values(summary);
  const passed = items.filter(Boolean).length;
  return { passed, failed: items.length - passed, total: items.length };
}
