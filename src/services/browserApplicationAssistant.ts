import type {
  AppSession,
  ApplicationAnswer,
  ApplicationFieldSource,
  ApplicationPackage,
  ApplicationRecord,
  BrowserApplicationSession,
  BrowserApplicationSessionStatus,
  BrowserAtsType,
  DetectedApplicationField,
  FilledApplicationField,
  NormalizedJob,
  Resume,
  UncertainApplicationField,
  UserProfile
} from "../models/domain";
import { browserApplicationSessionSchema } from "../models/schemas";
import { readJson, scopedKey, writeJson } from "../lib/storage";
import { loadApplications, updateApplicationStatus } from "./applicationService";

type AuditMetadata = Record<string, string | number | boolean | null>;

export interface BrowserAuditEvent {
  action: string;
  resourceType: string;
  resourceId: string;
  metadata: AuditMetadata;
}

export interface BrowserApplicationContext {
  session: AppSession;
  actorUserId: string;
  applicationPackage: ApplicationPackage;
  application: ApplicationRecord;
  job: NormalizedJob;
  profile: UserProfile | null;
  resume: Resume | null;
  answers: ApplicationAnswer[];
}

export interface BrowserApplicationResult {
  session: BrowserApplicationSession;
  sessions: BrowserApplicationSession[];
  application: ApplicationRecord;
  applications: ApplicationRecord[];
  auditEvents: BrowserAuditEvent[];
}

export interface BrowserAutomationDetectionResult {
  atsType: BrowserAtsType;
  fieldsDetected: DetectedApplicationField[];
  fieldsFilled: FilledApplicationField[];
  uncertainFields: UncertainApplicationField[];
  screenshotUrl: string | null;
}

export interface BrowserAutomationAdapter {
  name: string;
  runDetection(context: BrowserApplicationContext): Promise<BrowserAutomationDetectionResult>;
  submit(session: BrowserApplicationSession): Promise<{ submitted: boolean }>;
}

function createId(prefix: string): string {
  return `${prefix}_${globalThis.crypto.randomUUID()}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function browserSessionsKey(session: AppSession): string {
  return scopedKey(session.tenant.id, session.userId, "browser_application_sessions");
}

function statusLabel(status: BrowserApplicationSessionStatus): string {
  return status.replace(/_/g, " ");
}

function assertJobSeekerApproval(session: AppSession, actorUserId: string): void {
  if (actorUserId !== session.userId) {
    throw new Error("Only the job seeker can approve browser application actions.");
  }
}

function saveSessionList(
  session: AppSession,
  sessions: BrowserApplicationSession[]
): BrowserApplicationSession[] {
  const parsed = sessions.map((item) => browserApplicationSessionSchema.parse(item));
  writeJson(browserSessionsKey(session), parsed);
  return parsed;
}

function replaceSession(
  appSession: AppSession,
  updatedSession: BrowserApplicationSession
): BrowserApplicationSession[] {
  const sessions = loadBrowserApplicationSessions(appSession);
  const exists = sessions.some((item) => item.id === updatedSession.id);
  return saveSessionList(
    appSession,
    exists
      ? sessions.map((item) => (item.id === updatedSession.id ? updatedSession : item))
      : [updatedSession, ...sessions]
  );
}

function applicationForSession(
  session: AppSession,
  browserSession: BrowserApplicationSession
): ApplicationRecord {
  const application = loadApplications(session).find(
    (item) => item.id === browserSession.applicationRecordId
  );
  if (!application) {
    throw new Error("Application record was not found for browser session.");
  }

  return application;
}

function createEvent(
  action: string,
  browserSession: BrowserApplicationSession,
  metadata: AuditMetadata = {}
): BrowserAuditEvent {
  return {
    action,
    resourceType: "BrowserApplicationSession",
    resourceId: browserSession.id,
    metadata: {
      jobId: browserSession.jobId,
      applicationRecordId: browserSession.applicationRecordId,
      applicationPackageId: browserSession.applicationPackageId,
      status: browserSession.status,
      ...metadata
    }
  };
}

function filledPreview(source: ApplicationFieldSource, sourceField: string): string {
  if (source === "profile") {
    return `Saved profile field: ${sourceField}`;
  }

  if (source === "resume") {
    return "Approved resume draft from package";
  }

  if (source === "application_package") {
    return `Approved package content: ${sourceField}`;
  }

  if (source === "application_answer") {
    return `Approved answer: ${sourceField}`;
  }

  return "User review required";
}

function field(
  input: Omit<DetectedApplicationField, "confidence"> & { confidence?: number }
): DetectedApplicationField {
  return {
    ...input,
    confidence: input.confidence ?? 0.95
  };
}

function profileHasValue(profile: UserProfile | null, sourceField: string): boolean {
  if (!profile) {
    return false;
  }

  const value = profile[sourceField as keyof UserProfile];
  if (Array.isArray(value)) {
    return value.length > 0;
  }

  return value !== null && value !== undefined && String(value).trim().length > 0;
}

function detectAtsType(job: NormalizedJob): BrowserAtsType {
  if (job.atsType === "greenhouse" || job.atsType === "lever") {
    return job.atsType;
  }

  const url = job.applicationUrl.toLowerCase();
  if (url.includes("greenhouse")) {
    return "greenhouse";
  }

  if (url.includes("lever")) {
    return "lever";
  }

  if (url.includes("ashby")) {
    return "ashby";
  }

  if (url.includes("workday") || url.includes("myworkdayjobs")) {
    return "workday";
  }

  if (url.includes("linkedin")) {
    return "linkedin";
  }

  return url ? "custom" : "unknown";
}

function detectFields(context: BrowserApplicationContext): DetectedApplicationField[] {
  const profile = context.profile;
  const salaryConfigured = Boolean(profile?.salaryTarget || profile?.salaryMin);
  const answerFields = context.answers.map((answer, index) =>
    field({
      id: `answer_${index + 1}`,
      label: answer.question,
      fieldType: "textarea",
      required: false,
      sensitive: false,
      confidence: answer.needsUserReview ? 0.72 : 0.9,
      source: "application_answer",
      sourceField: answer.question
    })
  );

  return [
    field({
      id: "full_name",
      label: "Full name",
      fieldType: "text",
      required: true,
      sensitive: false,
      confidence: profileHasValue(profile, "fullName") ? 0.98 : 0.3,
      source: "profile",
      sourceField: "fullName"
    }),
    field({
      id: "email",
      label: "Email",
      fieldType: "email",
      required: true,
      sensitive: false,
      confidence: profileHasValue(profile, "email") ? 0.98 : 0.3,
      source: "profile",
      sourceField: "email"
    }),
    field({
      id: "phone",
      label: "Phone",
      fieldType: "phone",
      required: true,
      sensitive: false,
      confidence: profileHasValue(profile, "phone") ? 0.96 : 0.35,
      source: "profile",
      sourceField: "phone"
    }),
    field({
      id: "location",
      label: "Location",
      fieldType: "text",
      required: true,
      sensitive: false,
      confidence: profileHasValue(profile, "location") ? 0.94 : 0.35,
      source: "profile",
      sourceField: "location"
    }),
    field({
      id: "linkedin_url",
      label: "LinkedIn URL",
      fieldType: "url",
      required: false,
      sensitive: false,
      confidence: profileHasValue(profile, "linkedinUrl") ? 0.9 : 0.4,
      source: "profile",
      sourceField: "linkedinUrl"
    }),
    field({
      id: "portfolio_url",
      label: "Portfolio URL",
      fieldType: "url",
      required: false,
      sensitive: false,
      confidence: profileHasValue(profile, "portfolioUrl") ? 0.88 : 0.4,
      source: "profile",
      sourceField: "portfolioUrl"
    }),
    field({
      id: "github_url",
      label: "GitHub URL",
      fieldType: "url",
      required: false,
      sensitive: false,
      confidence: profileHasValue(profile, "githubUrl") ? 0.88 : 0.4,
      source: "profile",
      sourceField: "githubUrl"
    }),
    field({
      id: "work_authorization",
      label: "Work authorization",
      fieldType: "select",
      required: true,
      sensitive: false,
      confidence: profileHasValue(profile, "workAuthorization") ? 0.84 : 0.35,
      source: "profile",
      sourceField: "workAuthorization"
    }),
    field({
      id: "resume_upload",
      label: "Resume upload",
      fieldType: "file",
      required: true,
      sensitive: false,
      source: "resume",
      sourceField: "resumeMarkdown"
    }),
    field({
      id: "cover_letter_upload",
      label: "Cover letter upload",
      fieldType: "file",
      required: false,
      sensitive: false,
      source: "application_package",
      sourceField: "coverLetter"
    }),
    ...answerFields,
    field({
      id: "salary_expectations",
      label: "Salary expectations",
      fieldType: "text",
      required: true,
      sensitive: false,
      confidence: salaryConfigured ? 0.8 : 0.2,
      source: salaryConfigured ? "profile" : "user_required",
      sourceField: salaryConfigured ? "salaryTarget" : "salary expectations"
    }),
    field({
      id: "equal_opportunity",
      label: "Voluntary demographic questions",
      fieldType: "select",
      required: false,
      sensitive: true,
      confidence: 0.2,
      source: "user_required",
      sourceField: "demographic defaults"
    }),
    field({
      id: "captcha",
      label: "CAPTCHA or bot challenge",
      fieldType: "captcha",
      required: true,
      sensitive: true,
      confidence: 0.1,
      source: "user_required",
      sourceField: "captcha"
    }),
    field({
      id: "final_submit",
      label: "Final submit screen",
      fieldType: "checkbox",
      required: true,
      sensitive: true,
      confidence: 0.1,
      source: "user_required",
      sourceField: "final submit"
    })
  ];
}

function canFillField(
  fieldItem: DetectedApplicationField,
  context: BrowserApplicationContext
): boolean {
  if (fieldItem.sensitive || fieldItem.source === "user_required") {
    return false;
  }

  if (fieldItem.source === "profile") {
    return profileHasValue(context.profile, fieldItem.sourceField);
  }

  if (fieldItem.source === "resume") {
    return context.applicationPackage.resumeMarkdown.trim().length > 0;
  }

  if (fieldItem.source === "application_package") {
    return context.applicationPackage.coverLetter.trim().length > 0;
  }

  if (fieldItem.source === "application_answer") {
    return context.answers.some(
      (answer) =>
        answer.question === fieldItem.sourceField &&
        answer.answer.trim().length > 0 &&
        !answer.needsUserReview
    );
  }

  return false;
}

function fillFields(
  fields: DetectedApplicationField[],
  context: BrowserApplicationContext
): FilledApplicationField[] {
  return fields
    .filter((fieldItem) => canFillField(fieldItem, context))
    .map((fieldItem) => ({
      fieldId: fieldItem.id,
      label: fieldItem.label,
      source: fieldItem.source,
      sourceField: fieldItem.sourceField,
      valuePreview: filledPreview(fieldItem.source, fieldItem.sourceField),
      confidence: fieldItem.confidence
    }));
}

function uncertainForField(
  fieldItem: DetectedApplicationField,
  context: BrowserApplicationContext,
  filledFieldIds: Set<string>
): UncertainApplicationField | null {
  if (fieldItem.id === "captcha") {
    return {
      fieldId: fieldItem.id,
      label: fieldItem.label,
      reason: "captcha",
      required: fieldItem.required,
      guidance: "Human action is required; the assistant will not bypass CAPTCHA."
    };
  }

  if (fieldItem.id === "final_submit") {
    return {
      fieldId: fieldItem.id,
      label: fieldItem.label,
      reason: "final_submit",
      required: fieldItem.required,
      guidance: "Review all filled fields and explicitly approve before submit."
    };
  }

  if (fieldItem.id === "login_challenge") {
    return {
      fieldId: fieldItem.id,
      label: fieldItem.label,
      reason: "login_challenge",
      required: fieldItem.required,
      guidance:
        "Sign in manually if the job board requires authentication; credentials are never handled by the assistant."
    };
  }

  if (fieldItem.id === "salary_expectations" && !filledFieldIds.has(fieldItem.id)) {
    return {
      fieldId: fieldItem.id,
      label: fieldItem.label,
      reason: "salary_missing",
      required: fieldItem.required,
      guidance: "Add salary expectations in the profile or complete this field manually."
    };
  }

  if (fieldItem.id === "equal_opportunity") {
    return {
      fieldId: fieldItem.id,
      label: fieldItem.label,
      reason: "demographic",
      required: fieldItem.required,
      guidance:
        "Voluntary demographic questions require saved user defaults or manual input."
    };
  }

  if (fieldItem.required && !filledFieldIds.has(fieldItem.id)) {
    return {
      fieldId: fieldItem.id,
      label: fieldItem.label,
      reason: fieldItem.confidence < 0.5 ? "low_confidence" : "unclear_required",
      required: fieldItem.required,
      guidance: "Required field needs human input before the assistant can continue."
    };
  }

  const answer = context.answers.find(
    (item) => item.question === fieldItem.sourceField
  );
  if (fieldItem.source === "application_answer" && answer?.needsUserReview) {
    return {
      fieldId: fieldItem.id,
      label: fieldItem.label,
      reason: "low_confidence",
      required: fieldItem.required,
      guidance: "Review the approved answer before using it in an application form."
    };
  }

  return null;
}

function buildUncertainFields(
  fields: DetectedApplicationField[],
  filledFields: FilledApplicationField[],
  context: BrowserApplicationContext
): UncertainApplicationField[] {
  const filledFieldIds = new Set(filledFields.map((fieldItem) => fieldItem.fieldId));
  return fields
    .map((fieldItem) => uncertainForField(fieldItem, context, filledFieldIds))
    .filter((fieldItem): fieldItem is UncertainApplicationField => Boolean(fieldItem));
}

export class MockBrowserAutomationAdapter implements BrowserAutomationAdapter {
  name = "mock-browser-application-adapter";

  async runDetection(
    context: BrowserApplicationContext
  ): Promise<BrowserAutomationDetectionResult> {
    const atsType = detectAtsType(context.job);
    const baseFields = detectFields(context);
    const fieldsDetected =
      atsType === "linkedin"
        ? [
            ...baseFields,
            field({
              id: "login_challenge",
              label: "Login challenge",
              fieldType: "unknown",
              required: true,
              sensitive: true,
              confidence: 0.2,
              source: "user_required",
              sourceField: "login"
            })
          ]
        : baseFields;
    const fieldsFilled = fillFields(fieldsDetected, context);
    const uncertainFields = buildUncertainFields(
      fieldsDetected,
      fieldsFilled,
      context
    );

    return {
      atsType,
      fieldsDetected,
      fieldsFilled,
      uncertainFields,
      screenshotUrl: null
    };
  }

  async submit() {
    return { submitted: true };
  }
}

export class PlaywrightBrowserAutomationAdapterBoundary
  implements BrowserAutomationAdapter
{
  name = "playwright-boundary";

  async runDetection(): Promise<BrowserAutomationDetectionResult> {
    throw new Error("Playwright browser automation is not configured in this build.");
  }

  async submit(): Promise<{ submitted: boolean }> {
    throw new Error("Playwright browser automation is not configured in this build.");
  }
}

export function createMockBrowserAutomationAdapter(): BrowserAutomationAdapter {
  return new MockBrowserAutomationAdapter();
}

export function createPlaywrightAdapterBoundary(): BrowserAutomationAdapter {
  return new PlaywrightBrowserAutomationAdapterBoundary();
}

export function loadBrowserApplicationSessions(
  session: AppSession
): BrowserApplicationSession[] {
  const sessions = readJson<BrowserApplicationSession[]>(browserSessionsKey(session), []);
  return sessions.filter((item) => browserApplicationSessionSchema.safeParse(item).success);
}

export function saveBrowserApplicationSessions(
  session: AppSession,
  sessions: BrowserApplicationSession[]
): BrowserApplicationSession[] {
  return saveSessionList(session, sessions);
}

export function getBrowserSessionForPackage(
  session: AppSession,
  applicationPackageId: string
): BrowserApplicationSession | null {
  return (
    loadBrowserApplicationSessions(session)
      .filter((item) => item.applicationPackageId === applicationPackageId)
      .sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      )[0] ?? null
  );
}

export async function startBrowserApplicationSession(
  context: BrowserApplicationContext,
  adapter: BrowserAutomationAdapter = createMockBrowserAutomationAdapter()
): Promise<BrowserApplicationResult> {
  assertJobSeekerApproval(context.session, context.actorUserId);

  if (context.applicationPackage.status !== "approved") {
    throw new Error("Browser apply can start only from an approved package.");
  }

  const timestamp = nowIso();
  const queued = browserApplicationSessionSchema.parse({
    id: createId("browser"),
    tenantId: context.session.tenant.id,
    userId: context.session.userId,
    jobId: context.job.id,
    applicationRecordId: context.application.id,
    applicationPackageId: context.applicationPackage.id,
    atsType: "unknown",
    status: "queued",
    fieldsDetected: [],
    fieldsFilled: [],
    uncertainFields: [],
    screenshotUrl: null,
    errorMessage: "",
    createdAt: timestamp,
    updatedAt: timestamp
  });

  saveSessionList(context.session, [queued, ...loadBrowserApplicationSessions(context.session)]);

  const detection = await adapter.runDetection(context);
  const status: BrowserApplicationSessionStatus =
    detection.uncertainFields.length > 0 ? "needs_user_input" : "ready_for_review";
  const readySession = browserApplicationSessionSchema.parse({
    ...queued,
    atsType: detection.atsType,
    status,
    fieldsDetected: detection.fieldsDetected,
    fieldsFilled: detection.fieldsFilled,
    uncertainFields: detection.uncertainFields,
    screenshotUrl: detection.screenshotUrl,
    updatedAt: nowIso()
  });
  const sessions = replaceSession(context.session, readySession);
  const auditEvents: BrowserAuditEvent[] = [
    createEvent("browser_session_created", queued, { status: queued.status }),
    createEvent("browser_application_opened", readySession, {
      applicationUrlPresent: Boolean(context.job.applicationUrl)
    }),
    createEvent("ats_detected", readySession, { atsType: detection.atsType }),
    createEvent("form_fields_detected", readySession, {
      fieldCount: detection.fieldsDetected.length
    }),
    createEvent("form_field_filled", readySession, {
      fieldCount: detection.fieldsFilled.length
    })
  ];

  if (detection.uncertainFields.length > 0) {
    auditEvents.push(
      createEvent("uncertain_field_detected", readySession, {
        fieldCount: detection.uncertainFields.length
      })
    );
  }

  if (status === "ready_for_review") {
    auditEvents.push(createEvent("browser_session_ready_for_review", readySession));
  }

  return {
    session: readySession,
    sessions,
    application: context.application,
    applications: loadApplications(context.session),
    auditEvents
  };
}

export function markBrowserSessionReadyForReview(
  session: AppSession,
  browserSessionId: string
): BrowserApplicationResult {
  const existing = loadBrowserApplicationSessions(session).find(
    (item) => item.id === browserSessionId
  );
  if (!existing) {
    throw new Error("Browser application session was not found.");
  }

  if (existing.status !== "needs_user_input" && existing.status !== "filling") {
    throw new Error(
      `Cannot move a ${statusLabel(existing.status)} session to submit review.`
    );
  }

  const updated = browserApplicationSessionSchema.parse({
    ...existing,
    status: "ready_for_review",
    updatedAt: nowIso()
  });
  const sessions = replaceSession(session, updated);
  const application = applicationForSession(session, updated);

  return {
    session: updated,
    sessions,
    application,
    applications: loadApplications(session),
    auditEvents: [createEvent("browser_session_ready_for_review", updated)]
  };
}

export function approveBrowserSubmit(
  session: AppSession,
  browserSessionId: string,
  input: { actorUserId: string; approvedByUser: boolean }
): BrowserApplicationResult {
  assertJobSeekerApproval(session, input.actorUserId);
  if (!input.approvedByUser) {
    throw new Error("Explicit user approval is required before submit.");
  }

  const existing = loadBrowserApplicationSessions(session).find(
    (item) => item.id === browserSessionId
  );
  if (!existing) {
    throw new Error("Browser application session was not found.");
  }

  if (existing.status !== "ready_for_review") {
    throw new Error("Submit approval is available only after human review.");
  }

  const updated = browserApplicationSessionSchema.parse({
    ...existing,
    status: "approved_for_submit",
    updatedAt: nowIso()
  });
  const sessions = replaceSession(session, updated);
  const application = applicationForSession(session, updated);

  return {
    session: updated,
    sessions,
    application,
    applications: loadApplications(session),
    auditEvents: [createEvent("user_approved_browser_submit", updated)]
  };
}

export async function submitApprovedBrowserApplication(
  session: AppSession,
  browserSessionId: string,
  adapter: BrowserAutomationAdapter = createMockBrowserAutomationAdapter()
): Promise<BrowserApplicationResult> {
  const existing = loadBrowserApplicationSessions(session).find(
    (item) => item.id === browserSessionId
  );
  if (!existing) {
    throw new Error("Browser application session was not found.");
  }

  if (existing.status !== "approved_for_submit") {
    throw new Error("The assistant cannot submit before explicit user approval.");
  }

  const submitResult = await adapter.submit(existing);
  if (!submitResult.submitted) {
    return markBrowserSessionManualRequired(
      session,
      browserSessionId,
      "Automation could not confirm submission."
    );
  }

  const updated = browserApplicationSessionSchema.parse({
    ...existing,
    status: "submitted",
    updatedAt: nowIso()
  });
  const sessions = replaceSession(session, updated);
  const application = updateApplicationStatus(
    session,
    existing.applicationRecordId,
    "submitted"
  );

  return {
    session: updated,
    sessions,
    application,
    applications: loadApplications(session),
    auditEvents: [createEvent("application_submitted", updated)]
  };
}

export function markBrowserSessionManualRequired(
  session: AppSession,
  browserSessionId: string,
  reason = "Automation needs manual completion."
): BrowserApplicationResult {
  const existing = loadBrowserApplicationSessions(session).find(
    (item) => item.id === browserSessionId
  );
  if (!existing) {
    throw new Error("Browser application session was not found.");
  }

  const updated = browserApplicationSessionSchema.parse({
    ...existing,
    status: "manual_required",
    errorMessage: reason,
    updatedAt: nowIso()
  });
  const sessions = replaceSession(session, updated);
  const application = applicationForSession(session, updated);

  return {
    session: updated,
    sessions,
    application,
    applications: loadApplications(session),
    auditEvents: [
      createEvent("manual_application_required", updated, {
        reasonLength: reason.length
      })
    ]
  };
}

export function failBrowserSession(
  session: AppSession,
  browserSessionId: string,
  errorMessage: string
): BrowserApplicationResult {
  const existing = loadBrowserApplicationSessions(session).find(
    (item) => item.id === browserSessionId
  );
  if (!existing) {
    throw new Error("Browser application session was not found.");
  }

  const updated = browserApplicationSessionSchema.parse({
    ...existing,
    status: "failed",
    errorMessage,
    updatedAt: nowIso()
  });
  const sessions = replaceSession(session, updated);
  const application = applicationForSession(session, updated);

  return {
    session: updated,
    sessions,
    application,
    applications: loadApplications(session),
    auditEvents: [
      createEvent("browser_session_failed", updated, {
        errorLength: errorMessage.length
      })
    ]
  };
}
