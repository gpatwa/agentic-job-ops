import type {
  AppSession,
  ApplicationPackage,
  ApplicationRecord,
  AuditLog,
  BrowserApplicationSession,
  BrowserFillPlanItem,
  DetectedApplicationField,
  ExtensionPageStructure,
  ExtensionSession,
  ExtensionSessionStatus,
  FilledApplicationField,
  NormalizedJob,
  UncertainApplicationField,
  UserProfile
} from "../models/domain";
import {
  extensionPageStructureSchema,
  extensionSessionSchema
} from "../models/schemas";
import { readJson, scopedKey, writeJson } from "../lib/storage";
import { appendAuditLog, loadAuditLogs } from "./auditLog";
import {
  defaultATSAdapters,
  selectATSAdapter,
  type ATSPageSnapshot
} from "./atsAdapters";

type AuditMetadata = AuditLog["metadata"];

export interface ExtensionConnectionRequest {
  extensionInstanceId: string;
  pageUrl: string;
  pageTitle: string;
  hostname: string;
  applicationPackageId?: string | null;
  applicationRecordId?: string | null;
  jobId?: string | null;
  browserApplicationSessionId?: string | null;
}

export interface ExtensionFillPlanContext {
  applicationPackage?: ApplicationPackage | null;
  application?: ApplicationRecord | null;
  job?: NormalizedJob | null;
  profile?: UserProfile | null;
}

export interface ExtensionAuditEvent {
  action: string;
  resourceType: string;
  resourceId: string;
  metadata: AuditMetadata;
}

export interface ExtensionResult {
  session: ExtensionSession;
  sessions: ExtensionSession[];
  auditEvents: ExtensionAuditEvent[];
}

function createId(prefix: string): string {
  return `${prefix}_${globalThis.crypto.randomUUID()}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function extensionSessionsKey(session: AppSession): string {
  return scopedKey(session.tenant.id, session.userId, "extension_sessions");
}

function safeHostname(input: string): string {
  if (!input) {
    return "";
  }
  try {
    return new URL(input).hostname;
  } catch {
    return input;
  }
}

function hashStructure(structure: ExtensionPageStructure): string {
  const summary = `${structure.hostname}|${structure.fields.length}|${structure.fields
    .map((field) => `${field.fieldType}:${field.required ? 1 : 0}:${field.sensitive ? 1 : 0}`)
    .join(",")}|${structure.hasCaptcha ? 1 : 0}|${structure.hasLoginChallenge ? 1 : 0}`;
  let hash = 0;
  for (let i = 0; i < summary.length; i += 1) {
    hash = (hash * 31 + summary.charCodeAt(i)) | 0;
  }
  return `ext_${(hash >>> 0).toString(16)}`;
}

function statusLabel(status: ExtensionSessionStatus): string {
  return status.replace(/_/g, " ");
}

function assertJobSeeker(session: AppSession, actorUserId: string): void {
  if (actorUserId !== session.userId) {
    throw new Error("Only the job seeker can take this extension action.");
  }
}

function saveSessions(
  session: AppSession,
  sessions: ExtensionSession[]
): ExtensionSession[] {
  const parsed = sessions.map((item) => extensionSessionSchema.parse(item));
  writeJson(extensionSessionsKey(session), parsed.slice(0, 200));
  return parsed;
}

function replaceSession(
  session: AppSession,
  updated: ExtensionSession
): ExtensionSession[] {
  const sessions = loadExtensionSessions(session);
  const exists = sessions.some((item) => item.id === updated.id);
  return saveSessions(
    session,
    exists
      ? sessions.map((item) => (item.id === updated.id ? updated : item))
      : [updated, ...sessions]
  );
}

function event(
  action: string,
  extensionSession: ExtensionSession,
  metadata: AuditMetadata = {}
): ExtensionAuditEvent {
  return {
    action,
    resourceType: "ExtensionSession",
    resourceId: extensionSession.id,
    metadata: {
      hostname: extensionSession.hostname,
      status: extensionSession.status,
      jobId: extensionSession.jobId,
      applicationRecordId: extensionSession.applicationRecordId,
      applicationPackageId: extensionSession.applicationPackageId,
      browserApplicationSessionId: extensionSession.browserApplicationSessionId,
      ...metadata
    }
  };
}

function recordBlockedSubmit(
  appSession: AppSession,
  extensionSession: ExtensionSession | null,
  reason: string,
  extra: AuditMetadata = {}
): void {
  appendAuditLog(appSession, {
    action: "extension_submit_blocked",
    resourceType: "ExtensionSession",
    resourceId: extensionSession?.id ?? "unknown_extension_session",
    metadata: {
      reason,
      hostname: extensionSession?.hostname ?? null,
      status: extensionSession?.status ?? null,
      jobId: extensionSession?.jobId ?? null,
      applicationRecordId: extensionSession?.applicationRecordId ?? null,
      applicationPackageId: extensionSession?.applicationPackageId ?? null,
      ...extra
    }
  });
}

export function loadExtensionSessions(session: AppSession): ExtensionSession[] {
  const sessions = readJson<ExtensionSession[]>(extensionSessionsKey(session), []);
  return sessions.filter((item) => extensionSessionSchema.safeParse(item).success);
}

export function saveExtensionSessions(
  session: AppSession,
  sessions: ExtensionSession[]
): ExtensionSession[] {
  return saveSessions(session, sessions);
}

export function getExtensionSession(
  session: AppSession,
  sessionId: string
): ExtensionSession | null {
  return loadExtensionSessions(session).find((item) => item.id === sessionId) ?? null;
}

export function getExtensionSessionForBrowserSession(
  session: AppSession,
  browserApplicationSessionId: string
): ExtensionSession | null {
  return (
    loadExtensionSessions(session)
      .filter((item) => item.browserApplicationSessionId === browserApplicationSessionId)
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0] ??
    null
  );
}

export function createExtensionSession(
  session: AppSession,
  request: ExtensionConnectionRequest
): ExtensionResult {
  const timestamp = nowIso();
  const draft = extensionSessionSchema.parse({
    id: createId("ext"),
    tenantId: session.tenant.id,
    userId: session.userId,
    extensionInstanceId: request.extensionInstanceId,
    pageUrl: request.pageUrl,
    pageTitle: request.pageTitle,
    hostname: request.hostname || safeHostname(request.pageUrl),
    status: "awaiting_user_authorization",
    applicationPackageId: request.applicationPackageId ?? null,
    applicationRecordId: request.applicationRecordId ?? null,
    jobId: request.jobId ?? null,
    browserApplicationSessionId: request.browserApplicationSessionId ?? null,
    fieldsDetected: [],
    fieldsFilled: [],
    uncertainFields: [],
    fillPlan: [],
    pageStructureHash: "",
    authorizedAt: null,
    fillApprovedAt: null,
    submitApprovedAt: null,
    submittedAt: null,
    disconnectedAt: null,
    errorMessage: "",
    createdAt: timestamp,
    updatedAt: timestamp
  });

  const sessions = replaceSession(session, draft);

  return {
    session: draft,
    sessions,
    auditEvents: [
      event("extension_connection_requested", draft, {
        extensionInstanceId: draft.extensionInstanceId
      })
    ]
  };
}

export function authorizeExtensionSession(
  session: AppSession,
  sessionId: string,
  input: { actorUserId: string; authorizedByUser: boolean }
): ExtensionResult {
  assertJobSeeker(session, input.actorUserId);
  if (!input.authorizedByUser) {
    throw new Error("Explicit user authorization is required to connect the extension.");
  }

  const existing = getExtensionSession(session, sessionId);
  if (!existing) {
    throw new Error("Extension session was not found.");
  }

  if (existing.status !== "awaiting_user_authorization") {
    throw new Error(
      `Cannot authorize an extension session in status ${statusLabel(existing.status)}.`
    );
  }

  const timestamp = nowIso();
  const updated = extensionSessionSchema.parse({
    ...existing,
    status: "connected",
    authorizedAt: timestamp,
    updatedAt: timestamp
  });
  const sessions = replaceSession(session, updated);

  return {
    session: updated,
    sessions,
    auditEvents: [
      event("extension_connected", updated, {
        authorizedByUserId: input.actorUserId
      })
    ]
  };
}

function pageSnapshotFromStructure(structure: ExtensionPageStructure): ATSPageSnapshot {
  const fieldsHtml = structure.fields
    .map((field) => {
      const tag =
        field.fieldType === "textarea"
          ? "textarea"
          : field.fieldType === "select"
            ? "select"
            : "input";
      const inputType =
        tag === "input"
          ? `type="${
              field.fieldType === "email"
                ? "email"
                : field.fieldType === "phone"
                  ? "tel"
                  : field.fieldType === "url"
                    ? "url"
                    : field.fieldType === "file"
                      ? "file"
                      : field.fieldType === "checkbox"
                        ? "checkbox"
                        : "text"
            }"`
          : "";
      const required = field.required ? "required" : "";
      const placeholder = field.placeholder ? `placeholder="${field.placeholder}"` : "";
      return `
        <label for="${field.inputId || field.fieldId}">${field.label}</label>
        <${tag} id="${field.inputId || field.fieldId}" name="${field.inputName || field.fieldId}" ${inputType} ${placeholder} ${required}></${tag}>
      `;
    })
    .join("\n");

  const captchaHtml = structure.hasCaptcha ? '<div class="g-recaptcha">CAPTCHA</div>' : "";
  const loginHtml = structure.hasLoginChallenge
    ? '<input id="login_password" name="password" type="password" />'
    : "";
  const submitHtml = structure.hasSubmitButton
    ? '<button type="submit">Submit application</button>'
    : "";

  return {
    url: structure.pageUrl,
    html: `
      <main class="extension-ingested">
        <form class="application-form">
          ${fieldsHtml}
          ${captchaHtml}
          ${loginHtml}
          ${submitHtml}
        </form>
      </main>
    `,
    title: structure.pageTitle,
    safeFixture: false
  };
}

export function ingestExtensionPageStructure(
  session: AppSession,
  sessionId: string,
  rawStructure: ExtensionPageStructure
): ExtensionResult {
  const existing = getExtensionSession(session, sessionId);
  if (!existing) {
    throw new Error("Extension session was not found.");
  }

  if (
    existing.status !== "connected" &&
    existing.status !== "page_analyzed" &&
    existing.status !== "fill_plan_ready"
  ) {
    throw new Error(
      `Cannot ingest a page structure for a session in status ${statusLabel(existing.status)}.`
    );
  }

  const structure = extensionPageStructureSchema.parse(rawStructure);
  const snapshot = pageSnapshotFromStructure(structure);
  const { adapter } = selectATSAdapter(snapshot, defaultATSAdapters());
  const detectedForm = adapter.analyzeForm(snapshot);

  const timestamp = nowIso();
  const updated = extensionSessionSchema.parse({
    ...existing,
    status: "page_analyzed",
    pageUrl: structure.pageUrl,
    pageTitle: structure.pageTitle,
    hostname: structure.hostname,
    fieldsDetected: detectedForm.fields,
    pageStructureHash: hashStructure(structure),
    updatedAt: timestamp
  });
  const sessions = replaceSession(session, updated);

  return {
    session: updated,
    sessions,
    auditEvents: [
      event("application_page_analyzed", updated, {
        fieldCount: detectedForm.fields.length,
        hasCaptcha: structure.hasCaptcha,
        hasLoginChallenge: structure.hasLoginChallenge,
        adapterType: detectedForm.adapterType,
        adapterConfidence: Math.round(detectedForm.confidence * 100)
      })
    ]
  };
}

export function createExtensionFillPlan(
  session: AppSession,
  sessionId: string,
  context: ExtensionFillPlanContext = {}
): ExtensionResult {
  const existing = getExtensionSession(session, sessionId);
  if (!existing) {
    throw new Error("Extension session was not found.");
  }

  if (existing.status !== "page_analyzed") {
    throw new Error(
      `Fill plan creation requires page_analyzed status, got ${statusLabel(existing.status)}.`
    );
  }

  if (existing.fieldsDetected.length === 0) {
    throw new Error("No detected fields are available for fill plan creation.");
  }

  const synthesizedHtml = existing.fieldsDetected
    .map(
      (field) =>
        `<label for="${field.id}">${field.label}</label><input id="${field.id}" name="${field.id}" />`
    )
    .join("\n");
  const snapshot: ATSPageSnapshot = {
    url: existing.pageUrl,
    html: `<form>${synthesizedHtml}</form>`,
    title: existing.pageTitle,
    safeFixture: false
  };
  const { adapter } = selectATSAdapter(snapshot, defaultATSAdapters());
  const detectedForm = {
    adapterType: existing.fieldsDetected.length > 0 ? "unknown" : "unknown",
    adapterName: adapter.name,
    confidence: 0.6,
    fields: existing.fieldsDetected
  } as const;
  const fillPlan = adapter.createFillPlan(
    context.profile ?? null,
    context.applicationPackage ??
      ({
        id: existing.applicationPackageId ?? "demo_package",
        tenantId: session.tenant.id,
        userId: session.userId,
        jobId: existing.jobId ?? "demo_job",
        applicationRecordId: existing.applicationRecordId ?? "demo_app",
        status: context.applicationPackage ? "approved" : "draft",
        resumeMarkdown: "",
        coverLetter: "",
        generationMode: "deterministic",
        modelName: "demo",
        promptVersion: "demo",
        inputHash: "demo",
        outputHash: "demo",
        safetyWarnings: [],
        createdAt: nowIso(),
        updatedAt: nowIso(),
        approvedAt: null,
        rejectedAt: null
      } satisfies ApplicationPackage),
    {
      adapterType: existing.fieldsDetected.some((field) => field.id.startsWith("greenhouse_"))
        ? "greenhouse"
        : existing.fieldsDetected.some((field) => field.id.startsWith("lever_"))
          ? "lever"
          : detectedForm.adapterType,
      adapterName: detectedForm.adapterName,
      confidence: detectedForm.confidence,
      fields: detectedForm.fields
    },
    {
      answers: [],
      mode: "dry_run"
    }
  );

  const fieldsFilled: FilledApplicationField[] = fillPlan.fieldsFilled;
  const uncertainFields: UncertainApplicationField[] = fillPlan.uncertainFields;
  const items: BrowserFillPlanItem[] = fillPlan.items;

  const timestamp = nowIso();
  const updated = extensionSessionSchema.parse({
    ...existing,
    status: "fill_plan_ready",
    fieldsFilled: [],
    uncertainFields,
    fillPlan: items,
    updatedAt: timestamp
  });
  const sessions = replaceSession(session, updated);

  const blockingPause = uncertainFields.find(
    (item) => item.reason === "captcha" || item.reason === "login_challenge"
  );
  if (blockingPause) {
    const manual = markExtensionManualRequired(
      session,
      sessionId,
      `Manual completion required: ${blockingPause.reason} pause was detected.`
    );
    return {
      session: manual.session,
      sessions: manual.sessions,
      auditEvents: [
        event("fill_plan_created", updated, {
          fillCount: fieldsFilled.length,
          pauseCount: uncertainFields.length,
          plannedFieldCount: items.length
        }),
        ...manual.auditEvents
      ]
    };
  }

  return {
    session: updated,
    sessions,
    auditEvents: [
      event("fill_plan_created", updated, {
        fillCount: fieldsFilled.length,
        pauseCount: uncertainFields.length,
        plannedFieldCount: items.length
      })
    ]
  };
}

export function approveExtensionFill(
  session: AppSession,
  sessionId: string,
  input: { actorUserId: string; approvedByUser: boolean }
): ExtensionResult {
  assertJobSeeker(session, input.actorUserId);
  if (!input.approvedByUser) {
    throw new Error("Explicit user approval is required before the extension may fill fields.");
  }

  const existing = getExtensionSession(session, sessionId);
  if (!existing) {
    throw new Error("Extension session was not found.");
  }

  if (existing.status !== "fill_plan_ready") {
    throw new Error(
      `Fill approval requires fill_plan_ready status, got ${statusLabel(existing.status)}.`
    );
  }

  const timestamp = nowIso();
  const updated = extensionSessionSchema.parse({
    ...existing,
    status: "fill_approved",
    fillApprovedAt: timestamp,
    updatedAt: timestamp
  });
  const sessions = replaceSession(session, updated);

  return {
    session: updated,
    sessions,
    auditEvents: [
      event("user_approved_field_fill", updated, {
        approvedByUserId: input.actorUserId,
        fillCount: updated.fillPlan.filter((item) => item.action === "fill" || item.action === "upload")
          .length
      })
    ]
  };
}

export function recordExtensionFieldsFilled(
  session: AppSession,
  sessionId: string,
  filledFieldIds: string[]
): ExtensionResult {
  const existing = getExtensionSession(session, sessionId);
  if (!existing) {
    throw new Error("Extension session was not found.");
  }

  if (existing.status !== "fill_approved") {
    throw new Error(
      `Cannot record filled fields for a session in status ${statusLabel(existing.status)}.`
    );
  }

  const filledIdSet = new Set(filledFieldIds);
  const fieldsFilled: FilledApplicationField[] = existing.fillPlan
    .filter(
      (item) =>
        filledIdSet.has(item.fieldId) &&
        (item.action === "fill" || item.action === "upload")
    )
    .map((item) => ({
      fieldId: item.fieldId,
      label: item.label,
      source: item.source,
      sourceField: item.sourceField,
      valuePreview: item.valuePreview || "Filled by extension on user-authorized page",
      confidence: item.confidence
    }));

  const timestamp = nowIso();
  const updated = extensionSessionSchema.parse({
    ...existing,
    status: "ready_for_final_review",
    fieldsFilled,
    updatedAt: timestamp
  });
  const sessions = replaceSession(session, updated);

  return {
    session: updated,
    sessions,
    auditEvents: [
      event("extension_fields_filled", updated, {
        filledCount: fieldsFilled.length
      })
    ]
  };
}

export function approveExtensionSubmit(
  session: AppSession,
  sessionId: string,
  input: { actorUserId: string; approvedByUser: boolean }
): ExtensionResult {
  assertJobSeeker(session, input.actorUserId);
  if (!input.approvedByUser) {
    throw new Error("Explicit user approval is required before the extension may submit.");
  }

  const existing = getExtensionSession(session, sessionId);
  if (!existing) {
    throw new Error("Extension session was not found.");
  }

  if (existing.status !== "ready_for_final_review") {
    throw new Error(
      `Submit approval requires ready_for_final_review status, got ${statusLabel(existing.status)}.`
    );
  }

  const timestamp = nowIso();
  const updated = extensionSessionSchema.parse({
    ...existing,
    status: "submit_approved",
    submitApprovedAt: timestamp,
    updatedAt: timestamp
  });
  const sessions = replaceSession(session, updated);

  return {
    session: updated,
    sessions,
    auditEvents: [
      event("user_approved_extension_submit", updated, {
        approvedByUserId: input.actorUserId,
        approvedFromStatus: existing.status
      })
    ]
  };
}

function hasExtensionSubmitApprovalAudit(
  appSession: AppSession,
  extensionSession: ExtensionSession,
  submitAttemptedAt: string
): boolean {
  return loadAuditLogs(appSession).some(
    (log) =>
      log.action === "user_approved_extension_submit" &&
      log.resourceType === "ExtensionSession" &&
      log.resourceId === extensionSession.id &&
      log.tenantId === appSession.tenant.id &&
      log.actorUserId === appSession.userId &&
      log.metadata.approvedByUserId === appSession.userId &&
      log.metadata.approvedFromStatus === "ready_for_final_review" &&
      new Date(log.createdAt).getTime() <= new Date(submitAttemptedAt).getTime()
  );
}

export function recordExtensionSubmitCompleted(
  session: AppSession,
  sessionId: string,
  input: {
    actorUserId: string;
    confirmationDetected: boolean;
    applicationPackage?: ApplicationPackage | null;
  }
): ExtensionResult {
  const submitAttemptedAt = nowIso();
  const existing = getExtensionSession(session, sessionId);
  if (!existing) {
    recordBlockedSubmit(session, null, "session_not_found", {
      requestedSessionId: sessionId
    });
    throw new Error("Extension session was not found.");
  }

  if (
    existing.tenantId !== session.tenant.id ||
    existing.userId !== session.userId
  ) {
    recordBlockedSubmit(session, existing, "session_tenant_or_user_mismatch", {
      sessionTenantId: existing.tenantId,
      sessionUserId: existing.userId
    });
    throw new Error("Extension session does not belong to this tenant or user.");
  }

  if (input.actorUserId !== session.userId) {
    recordBlockedSubmit(session, existing, "actor_not_job_seeker", {
      actorUserId: input.actorUserId
    });
    throw new Error("Only the job seeker can record extension submit completion.");
  }

  if (existing.status !== "submit_approved") {
    recordBlockedSubmit(session, existing, "session_not_submit_approved");
    throw new Error("The extension cannot mark submit complete before explicit user approval.");
  }

  if (!hasExtensionSubmitApprovalAudit(session, existing, submitAttemptedAt)) {
    recordBlockedSubmit(session, existing, "missing_or_invalid_approval_audit");
    throw new Error(
      "The extension cannot submit without a persisted approval audit for this session."
    );
  }

  if (existing.applicationPackageId && input.applicationPackage) {
    if (
      input.applicationPackage.id !== existing.applicationPackageId ||
      input.applicationPackage.status !== "approved"
    ) {
      recordBlockedSubmit(session, existing, "linked_package_not_approved", {
        packageStatus: input.applicationPackage.status
      });
      throw new Error("The linked application package is no longer approved.");
    }
  }

  const blockingPause = existing.uncertainFields.find(
    (field) => field.reason === "captcha" || field.reason === "login_challenge"
  );
  if (blockingPause) {
    recordBlockedSubmit(session, existing, "captcha_or_login_pause_present", {
      pauseReason: blockingPause.reason,
      pauseFieldId: blockingPause.fieldId
    });
    return markExtensionManualRequired(
      session,
      sessionId,
      `Manual completion required: ${blockingPause.reason} pause was still present at submit time.`
    );
  }

  if (!input.confirmationDetected) {
    recordBlockedSubmit(session, existing, "submit_not_confirmed");
    return markExtensionManualRequired(
      session,
      sessionId,
      "Extension could not confirm submission."
    );
  }

  const timestamp = nowIso();
  const updated = extensionSessionSchema.parse({
    ...existing,
    status: "submitted",
    submittedAt: timestamp,
    updatedAt: timestamp
  });
  const sessions = replaceSession(session, updated);

  return {
    session: updated,
    sessions,
    auditEvents: [
      event("extension_submit_completed", updated, {
        confirmationDetected: true
      })
    ]
  };
}

export function disconnectExtensionSession(
  session: AppSession,
  sessionId: string,
  reason = "User disconnected the extension."
): ExtensionResult {
  const existing = getExtensionSession(session, sessionId);
  if (!existing) {
    throw new Error("Extension session was not found.");
  }

  const timestamp = nowIso();
  const updated = extensionSessionSchema.parse({
    ...existing,
    status: "disconnected",
    disconnectedAt: timestamp,
    errorMessage: reason,
    updatedAt: timestamp
  });
  const sessions = replaceSession(session, updated);

  return {
    session: updated,
    sessions,
    auditEvents: [
      event("extension_disconnected", updated, {
        reasonLength: reason.length
      })
    ]
  };
}

export function markExtensionManualRequired(
  session: AppSession,
  sessionId: string,
  reason = "Extension paused for manual completion."
): ExtensionResult {
  const existing = getExtensionSession(session, sessionId);
  if (!existing) {
    throw new Error("Extension session was not found.");
  }

  const timestamp = nowIso();
  const updated = extensionSessionSchema.parse({
    ...existing,
    status: "manual_required",
    errorMessage: reason,
    updatedAt: timestamp
  });
  const sessions = replaceSession(session, updated);

  return {
    session: updated,
    sessions,
    auditEvents: [
      event("extension_manual_required", updated, {
        reasonLength: reason.length
      })
    ]
  };
}

export function failExtensionSession(
  session: AppSession,
  sessionId: string,
  reason: string
): ExtensionResult {
  const existing = getExtensionSession(session, sessionId);
  if (!existing) {
    throw new Error("Extension session was not found.");
  }

  const timestamp = nowIso();
  const updated = extensionSessionSchema.parse({
    ...existing,
    status: "failed",
    errorMessage: reason,
    updatedAt: timestamp
  });
  const sessions = replaceSession(session, updated);

  return {
    session: updated,
    sessions,
    auditEvents: [
      event("extension_session_failed", updated, {
        reasonLength: reason.length
      })
    ]
  };
}

export function summarizeExtensionSessions(
  sessions: ExtensionSession[]
): Record<ExtensionSessionStatus, number> {
  const counts: Record<string, number> = {};
  sessions.forEach((session) => {
    counts[session.status] = (counts[session.status] ?? 0) + 1;
  });
  return counts as Record<ExtensionSessionStatus, number>;
}

export function describeExtensionSession(
  extensionSession: ExtensionSession,
  browserApplicationSession?: BrowserApplicationSession | null
): {
  status: ExtensionSessionStatus;
  fillCount: number;
  pauseCount: number;
  detectedCount: number;
  linkedBrowserStatus: string | null;
} {
  return {
    status: extensionSession.status,
    fillCount: extensionSession.fieldsFilled.length,
    pauseCount: extensionSession.uncertainFields.length,
    detectedCount: extensionSession.fieldsDetected.length,
    linkedBrowserStatus: browserApplicationSession?.status ?? null
  };
}

export function isExtensionSubmitAllowed(
  extensionSession: ExtensionSession,
  applicationPackage?: ApplicationPackage | null
): boolean {
  if (extensionSession.status !== "submit_approved") {
    return false;
  }
  if (extensionSession.applicationPackageId && applicationPackage) {
    if (
      applicationPackage.id !== extensionSession.applicationPackageId ||
      applicationPackage.status !== "approved"
    ) {
      return false;
    }
  }
  if (
    extensionSession.uncertainFields.some(
      (field) => field.reason === "captcha" || field.reason === "login_challenge"
    )
  ) {
    return false;
  }
  return true;
}

export type ExtensionFillableFieldsView = {
  fieldId: string;
  label: string;
  action: BrowserFillPlanItem["action"];
  source: BrowserFillPlanItem["source"];
  valuePreview: string;
  reason: string;
}[];

export function extensionFillableView(
  extensionSession: ExtensionSession
): ExtensionFillableFieldsView {
  return extensionSession.fillPlan.map((item) => ({
    fieldId: item.fieldId,
    label: item.label,
    action: item.action,
    source: item.source,
    valuePreview: item.valuePreview,
    reason: item.reason
  }));
}

// Re-exports for convenience
export type {
  DetectedApplicationField,
  ExtensionSession,
  ExtensionSessionStatus,
  ExtensionPageStructure
} from "../models/domain";
