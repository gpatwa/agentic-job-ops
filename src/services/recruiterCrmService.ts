import type {
  ApplicationRecord,
  AppSession,
  AuditLog,
  CompanyIntelligence,
  FollowUpReminder,
  FollowUpReminderStatus,
  InterviewNote,
  InterviewStage,
  NormalizedJob,
  OutreachDraft,
  OutreachDraftStatus,
  OutreachDraftType,
  RecruiterContact,
  RecruiterContactConfidence,
  RecruiterContactSource,
  UserProfile
} from "../models/domain";
import {
  followUpReminderSchema,
  interviewNoteSchema,
  outreachDraftSchema,
  recruiterContactSchema
} from "../models/schemas";
import { readJson, scopedKey, writeJson } from "../lib/storage";

type AuditMetadata = AuditLog["metadata"];

/**
 * Phase 14 — Recruiter CRM and follow-up agent.
 *
 * - Deterministic-first. Outreach drafts are generated from verified
 *   profile, job, application, and recruiter context only. Real LLM
 *   integration goes through the adapter boundary; the placeholder adapter
 *   throws so this build never silently calls a model.
 * - Never invents recruiter names. If no recruiter contact is provided the
 *   draft falls back to a generic "Hi team" salutation.
 * - Never auto-sends. Drafts move through draft → edited → approved →
 *   sent_manually only when the user clicks each step.
 * - Type-specific safety gates: thank_you needs an interview note or an
 *   interview-stage application status. negotiation requires offer status.
 *   follow_up requires a submitted/contacted/interviewing status. These
 *   gates may be overridden explicitly by the caller for edge cases.
 * - Never scrapes LinkedIn or any private surface. All recruiter contacts
 *   are user-entered or derived from existing CompanyIntelligence the user
 *   already generated.
 */

export interface RecruiterCrmAuditEvent {
  action: string;
  resourceType: string;
  resourceId: string;
  metadata: AuditMetadata;
}

export interface CrmForApplication {
  contacts: RecruiterContact[];
  drafts: OutreachDraft[];
  reminders: FollowUpReminder[];
  interviewNotes: InterviewNote[];
}

export interface OutreachDraftContext {
  job: NormalizedJob;
  application: ApplicationRecord;
  profile: UserProfile | null;
  recruiterContact: RecruiterContact | null;
  interviewNotes: InterviewNote[];
  intelligence: CompanyIntelligence | null;
}

export interface OutreachAdapter {
  name: string;
  generate(input: {
    type: OutreachDraftType;
    context: OutreachDraftContext;
  }): Promise<{
    subject: string;
    body: string;
    modelName: string;
    promptVersion: string;
  }>;
}

const PROMPT_VERSION = "recruiter-crm-v1";

function nowIso(): string {
  return new Date().toISOString();
}

function createId(prefix: string): string {
  return `${prefix}_${globalThis.crypto.randomUUID()}`;
}

function contactsKey(session: AppSession): string {
  return scopedKey(session.tenant.id, session.userId, "recruiter_contacts");
}

function draftsKey(session: AppSession): string {
  return scopedKey(session.tenant.id, session.userId, "outreach_drafts");
}

function remindersKey(session: AppSession): string {
  return scopedKey(session.tenant.id, session.userId, "follow_up_reminders");
}

function notesKey(session: AppSession): string {
  return scopedKey(session.tenant.id, session.userId, "interview_notes");
}

export function loadRecruiterContacts(session: AppSession): RecruiterContact[] {
  const records = readJson<RecruiterContact[]>(contactsKey(session), []);
  return records.filter(
    (record) => recruiterContactSchema.safeParse(record).success
  );
}

export function saveRecruiterContacts(
  session: AppSession,
  records: RecruiterContact[]
): RecruiterContact[] {
  const parsed = records.map((record) => recruiterContactSchema.parse(record));
  writeJson(contactsKey(session), parsed.slice(0, 500));
  return parsed;
}

export function loadOutreachDrafts(session: AppSession): OutreachDraft[] {
  const records = readJson<OutreachDraft[]>(draftsKey(session), []);
  return records.filter(
    (record) => outreachDraftSchema.safeParse(record).success
  );
}

export function saveOutreachDrafts(
  session: AppSession,
  records: OutreachDraft[]
): OutreachDraft[] {
  const parsed = records.map((record) => outreachDraftSchema.parse(record));
  writeJson(draftsKey(session), parsed.slice(0, 500));
  return parsed;
}

export function loadFollowUpReminders(session: AppSession): FollowUpReminder[] {
  const records = readJson<FollowUpReminder[]>(remindersKey(session), []);
  return records.filter(
    (record) => followUpReminderSchema.safeParse(record).success
  );
}

export function saveFollowUpReminders(
  session: AppSession,
  records: FollowUpReminder[]
): FollowUpReminder[] {
  const parsed = records.map((record) => followUpReminderSchema.parse(record));
  writeJson(remindersKey(session), parsed.slice(0, 500));
  return parsed;
}

export function loadInterviewNotes(session: AppSession): InterviewNote[] {
  const records = readJson<InterviewNote[]>(notesKey(session), []);
  return records.filter(
    (record) => interviewNoteSchema.safeParse(record).success
  );
}

export function saveInterviewNotes(
  session: AppSession,
  records: InterviewNote[]
): InterviewNote[] {
  const parsed = records.map((record) => interviewNoteSchema.parse(record));
  writeJson(notesKey(session), parsed.slice(0, 500));
  return parsed;
}

function audit(
  action: string,
  resourceType: string,
  resourceId: string,
  metadata: AuditMetadata = {}
): RecruiterCrmAuditEvent {
  return { action, resourceType, resourceId, metadata };
}

export interface AddRecruiterContactInput {
  jobId: string;
  applicationRecordId: string | null;
  company: string;
  name?: string;
  title?: string;
  email?: string;
  publicProfileUrl?: string;
  notes?: string;
  source?: RecruiterContactSource;
  confidence?: RecruiterContactConfidence;
}

export interface AddRecruiterContactResult {
  contact: RecruiterContact;
  contacts: RecruiterContact[];
  auditEvents: RecruiterCrmAuditEvent[];
}

export function addRecruiterContact(
  session: AppSession,
  input: AddRecruiterContactInput
): AddRecruiterContactResult {
  // Defense-in-depth: never invent a recruiter name. Caller passes empty
  // string when the lead is anonymous.
  const timestamp = nowIso();
  const contact = recruiterContactSchema.parse({
    id: createId("contact"),
    tenantId: session.tenant.id,
    userId: session.userId,
    jobId: input.jobId,
    applicationRecordId: input.applicationRecordId,
    company: input.company,
    name: input.name ?? "",
    title: input.title ?? "",
    email: input.email ?? "",
    publicProfileUrl: input.publicProfileUrl ?? "",
    source: input.source ?? "user_entered",
    confidence: input.confidence ?? "low",
    notes: input.notes ?? "",
    createdAt: timestamp,
    updatedAt: timestamp
  });
  const contacts = saveRecruiterContacts(session, [
    contact,
    ...loadRecruiterContacts(session)
  ]);
  return {
    contact,
    contacts,
    auditEvents: [
      audit("recruiter_contact_added", "RecruiterContact", contact.id, {
        jobId: contact.jobId,
        company: contact.company,
        source: contact.source,
        applicationRecordId: contact.applicationRecordId ?? ""
      })
    ]
  };
}

export interface UpdateRecruiterContactInput {
  id: string;
  name?: string;
  title?: string;
  email?: string;
  publicProfileUrl?: string;
  notes?: string;
  confidence?: RecruiterContactConfidence;
}

export function updateRecruiterContact(
  session: AppSession,
  input: UpdateRecruiterContactInput
): AddRecruiterContactResult {
  const existing = loadRecruiterContacts(session);
  const target = existing.find((contact) => contact.id === input.id);
  if (!target) {
    throw new Error(`Recruiter contact ${input.id} not found.`);
  }
  const updated = recruiterContactSchema.parse({
    ...target,
    name: input.name ?? target.name,
    title: input.title ?? target.title,
    email: input.email ?? target.email,
    publicProfileUrl: input.publicProfileUrl ?? target.publicProfileUrl,
    notes: input.notes ?? target.notes,
    confidence: input.confidence ?? target.confidence,
    updatedAt: nowIso()
  });
  const contacts = saveRecruiterContacts(
    session,
    existing.map((contact) => (contact.id === updated.id ? updated : contact))
  );
  return {
    contact: updated,
    contacts,
    auditEvents: [
      audit("recruiter_contact_updated", "RecruiterContact", updated.id, {
        jobId: updated.jobId
      })
    ]
  };
}

function applicationStatusAllowsType(
  type: OutreachDraftType,
  status: ApplicationRecord["status"]
): boolean {
  if (type === "negotiation") {
    return status === "offer";
  }
  if (type === "thank_you") {
    return (
      status === "interviewing" ||
      status === "recruiter_contacted" ||
      status === "offer"
    );
  }
  if (type === "follow_up") {
    return (
      status === "submitted" ||
      status === "recruiter_contacted" ||
      status === "interviewing"
    );
  }
  if (type === "rejection_response") {
    return status === "rejected";
  }
  if (type === "interview_availability") {
    return (
      status === "recruiter_contacted" || status === "interviewing"
    );
  }
  // recruiter_intro and referral_request are valid at any stage — they are
  // reach-out drafts the user composes before formal contact begins.
  return true;
}

function safeRecruiterFirstName(contact: RecruiterContact | null): string {
  if (!contact) return "";
  const trimmed = contact.name.trim();
  if (trimmed.length === 0) return "";
  const first = trimmed.split(/\s+/)[0];
  // Defense-in-depth: only use first name if it looks like a real word.
  if (!/^[A-Za-z][A-Za-z'\-]*$/.test(first)) return "";
  return first;
}

function salutation(contact: RecruiterContact | null): string {
  const first = safeRecruiterFirstName(contact);
  return first ? `Hi ${first}` : "Hi team";
}

function applicantSignOff(profile: UserProfile | null): string {
  if (!profile) return "Best,\nA candidate";
  const name = profile.fullName.trim();
  return name ? `Best,\n${name}` : "Best,\nA candidate";
}

function intelligenceHook(
  intelligence: CompanyIntelligence | null,
  fallback: string
): string {
  if (!intelligence) return fallback;
  const summary = intelligence.summary.trim();
  if (!summary) return fallback;
  return summary;
}

function buildRecruiterIntro(context: OutreachDraftContext): {
  subject: string;
  body: string;
} {
  const { job, profile, recruiterContact, intelligence } = context;
  const subject = `Quick note re: ${job.title} at ${job.company}`;
  const lines = [
    salutation(recruiterContact) + ",",
    "",
    `I came across the ${job.title} role at ${job.company} and wanted to reach out directly.`,
    intelligenceHook(
      intelligence,
      `${job.company} stood out for the work described in the posting, and the role aligns with the direction I am focused on.`
    ),
    profile && profile.careerSummary.trim().length > 0
      ? `For context: ${profile.careerSummary.trim()}`
      : "I'd be glad to share more context on my background if helpful.",
    "",
    "If it's a useful conversation, I'd appreciate a few minutes to learn more about how you're thinking about the role.",
    "",
    applicantSignOff(profile)
  ];
  return { subject, body: lines.join("\n") };
}

function buildReferralRequest(context: OutreachDraftContext): {
  subject: string;
  body: string;
} {
  const { job, profile, recruiterContact } = context;
  const subject = `${job.title} at ${job.company} — quick referral question`;
  const lines = [
    salutation(recruiterContact) + ",",
    "",
    `I'm exploring the ${job.title} role at ${job.company} and thought it would be worth asking whether a referral might be a possibility.`,
    profile && profile.careerSummary.trim().length > 0
      ? `My recent background: ${profile.careerSummary.trim()}`
      : "I can send over a short summary of my background if useful.",
    "",
    "Completely understand if you'd rather not — appreciate you taking a look either way.",
    "",
    applicantSignOff(profile)
  ];
  return { subject, body: lines.join("\n") };
}

function buildFollowUp(context: OutreachDraftContext): {
  subject: string;
  body: string;
} {
  const { job, profile, recruiterContact, application } = context;
  const submittedAt = application.updatedAt ?? application.createdAt;
  const subject = `Following up — ${job.title} at ${job.company}`;
  const lines = [
    salutation(recruiterContact) + ",",
    "",
    `I'm following up on my application for the ${job.title} role at ${job.company} (submitted ${friendlyDate(submittedAt)}).`,
    "I wanted to check whether there are any updates or anything you need from my side to keep the process moving.",
    "",
    "Thanks for your time — happy to share more detail on any part of my background.",
    "",
    applicantSignOff(profile)
  ];
  return { subject, body: lines.join("\n") };
}

function buildThankYou(context: OutreachDraftContext): {
  subject: string;
  body: string;
} {
  const { job, profile, recruiterContact, interviewNotes } = context;
  const latestNote = [...interviewNotes].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt)
  )[0] ?? null;
  const stageLabel = latestNote ? interviewStageLabel(latestNote.stage) : null;
  const subject = stageLabel
    ? `Thank you — ${job.title} ${stageLabel}`
    : `Thank you — ${job.title} at ${job.company}`;
  const stageLine = latestNote
    ? `Thank you for the ${interviewStageLabel(latestNote.stage)} for the ${job.title} role at ${job.company}.`
    : `Thank you for the conversation about the ${job.title} role at ${job.company}.`;
  const reflectionLine =
    latestNote && latestNote.notes.trim().length > 0
      ? `I appreciated the discussion — particularly around ${truncate(latestNote.notes.trim(), 140)}.`
      : "I appreciated the time and the chance to learn more about the role.";
  const followUpLine =
    latestNote && latestNote.followUps.length > 0
      ? `As discussed, I'll follow up on: ${latestNote.followUps.slice(0, 3).join("; ")}.`
      : "Happy to share any additional information that would be helpful.";
  const lines = [
    salutation(recruiterContact) + ",",
    "",
    stageLine,
    reflectionLine,
    followUpLine,
    "",
    applicantSignOff(profile)
  ];
  return { subject, body: lines.join("\n") };
}

function buildInterviewAvailability(context: OutreachDraftContext): {
  subject: string;
  body: string;
} {
  const { job, profile, recruiterContact } = context;
  const subject = `Interview availability — ${job.title}`;
  const lines = [
    salutation(recruiterContact) + ",",
    "",
    `Sharing availability for the ${job.title} interview at ${job.company}.`,
    "I'd suggest filling in two or three windows that work in your time zone before sending — leaving placeholders below to keep this draft fact-based.",
    "",
    "- [ ] Window 1: <day, date, time, time zone>",
    "- [ ] Window 2: <day, date, time, time zone>",
    "- [ ] Window 3: <day, date, time, time zone>",
    "",
    "Happy to flex around the team's preference.",
    "",
    applicantSignOff(profile)
  ];
  return { subject, body: lines.join("\n") };
}

function buildNegotiation(context: OutreachDraftContext): {
  subject: string;
  body: string;
} {
  const { job, profile, recruiterContact } = context;
  const subject = `Re: offer for ${job.title} at ${job.company}`;
  const targetLine =
    profile && profile.salaryTarget && profile.salaryTarget > 0
      ? `Based on the level and the scope we discussed, my target compensation is in the range of $${profile.salaryTarget.toLocaleString()} base. Open to discussing total package mix.`
      : "I'd appreciate the chance to talk through total compensation — base, equity, and any sign-on — before finalising.";
  const lines = [
    salutation(recruiterContact) + ",",
    "",
    `Thank you again for the offer for the ${job.title} role at ${job.company}. I'm excited about the opportunity.`,
    "Before signing, I'd like to align on a few details so we land on something that works for both sides.",
    targetLine,
    "If helpful, I'm happy to jump on a quick call to walk through this together.",
    "",
    applicantSignOff(profile)
  ];
  return { subject, body: lines.join("\n") };
}

function buildRejectionResponse(context: OutreachDraftContext): {
  subject: string;
  body: string;
} {
  const { job, profile, recruiterContact } = context;
  const subject = `Re: ${job.title} at ${job.company}`;
  const lines = [
    salutation(recruiterContact) + ",",
    "",
    `Thank you for letting me know about the decision on the ${job.title} role.`,
    `I appreciate the time the team invested. I remain interested in ${job.company} and would welcome the chance to be considered for similar roles in the future.`,
    "If there's any specific feedback you can share, I'd find it genuinely useful as I keep iterating.",
    "",
    applicantSignOff(profile)
  ];
  return { subject, body: lines.join("\n") };
}

function interviewStageLabel(stage: InterviewStage): string {
  switch (stage) {
    case "recruiter_screen":
      return "recruiter screen";
    case "hiring_manager":
      return "hiring manager interview";
    case "technical":
      return "technical interview";
    case "behavioral":
      return "behavioural interview";
    case "onsite":
      return "onsite";
    case "final":
      return "final round";
    case "offer":
      return "offer conversation";
  }
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1).trimEnd() + "…";
}

function friendlyDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "recently";
  return date.toISOString().slice(0, 10);
}

class DeterministicOutreachAdapter implements OutreachAdapter {
  name = "deterministic-outreach-adapter";
  modelName = "deterministic-outreach-v1";
  async generate(input: {
    type: OutreachDraftType;
    context: OutreachDraftContext;
  }): Promise<{
    subject: string;
    body: string;
    modelName: string;
    promptVersion: string;
  }> {
    const { type, context } = input;
    let composed: { subject: string; body: string };
    switch (type) {
      case "recruiter_intro":
        composed = buildRecruiterIntro(context);
        break;
      case "referral_request":
        composed = buildReferralRequest(context);
        break;
      case "follow_up":
        composed = buildFollowUp(context);
        break;
      case "thank_you":
        composed = buildThankYou(context);
        break;
      case "interview_availability":
        composed = buildInterviewAvailability(context);
        break;
      case "negotiation":
        composed = buildNegotiation(context);
        break;
      case "rejection_response":
        composed = buildRejectionResponse(context);
        break;
    }
    return {
      ...composed,
      modelName: this.modelName,
      promptVersion: PROMPT_VERSION
    };
  }
}

export class PlaceholderLlmOutreachAdapter implements OutreachAdapter {
  name = "llm-outreach-adapter-boundary";
  async generate(): Promise<never> {
    throw new Error("LLM outreach adapter is not configured in this build.");
  }
}

export function createDeterministicOutreachAdapter(): OutreachAdapter {
  return new DeterministicOutreachAdapter();
}

export interface GenerateOutreachDraftInput {
  type: OutreachDraftType;
  job: NormalizedJob;
  application: ApplicationRecord;
  recruiterContact: RecruiterContact | null;
  profile: UserProfile | null;
  intelligence: CompanyIntelligence | null;
  interviewNotes: InterviewNote[];
  overrideSafetyGate?: boolean;
  generationMode?: "deterministic" | "llm";
}

export interface GenerateOutreachDraftResult {
  draft: OutreachDraft;
  drafts: OutreachDraft[];
  auditEvents: RecruiterCrmAuditEvent[];
}

export async function generateOutreachDraft(
  session: AppSession,
  input: GenerateOutreachDraftInput,
  adapter: OutreachAdapter = createDeterministicOutreachAdapter()
): Promise<GenerateOutreachDraftResult> {
  if (input.type === "thank_you" && !input.overrideSafetyGate) {
    // Thank-you has its own gate so we report the most specific reason: a
    // thank-you note implies an interview happened, so it must be backed by
    // an interview note or by the application already being in an interview/
    // offer stage. This runs before the generic status gate so the user
    // gets the precise reason it was blocked.
    const hasNote =
      input.interviewNotes.length > 0 ||
      input.application.status === "interviewing" ||
      input.application.status === "offer";
    if (!hasNote) {
      throw new Error(
        "Cannot generate a thank-you draft without an interview note or interview/offer status."
      );
    }
  } else {
    const safe = applicationStatusAllowsType(
      input.type,
      input.application.status
    );
    if (!safe && !input.overrideSafetyGate) {
      throw new Error(
        `Outreach type "${input.type}" is not allowed while application status is "${input.application.status}".`
      );
    }
  }
  const generated = await adapter.generate({
    type: input.type,
    context: {
      job: input.job,
      application: input.application,
      profile: input.profile,
      recruiterContact: input.recruiterContact,
      interviewNotes: input.interviewNotes,
      intelligence: input.intelligence
    }
  });
  const timestamp = nowIso();
  const draft = outreachDraftSchema.parse({
    id: createId("draft"),
    tenantId: session.tenant.id,
    userId: session.userId,
    jobId: input.job.id,
    applicationRecordId: input.application.id,
    recruiterContactId: input.recruiterContact?.id ?? null,
    type: input.type,
    subject: generated.subject,
    body: generated.body,
    status: "draft" as OutreachDraftStatus,
    generationMode: input.generationMode ?? "deterministic",
    modelName: generated.modelName,
    promptVersion: generated.promptVersion,
    createdAt: timestamp,
    updatedAt: timestamp,
    approvedAt: null,
    sentManuallyAt: null
  });
  const drafts = saveOutreachDrafts(session, [
    draft,
    ...loadOutreachDrafts(session)
  ]);
  return {
    draft,
    drafts,
    auditEvents: [
      audit("outreach_draft_generated", "OutreachDraft", draft.id, {
        type: draft.type,
        jobId: draft.jobId,
        applicationRecordId: draft.applicationRecordId ?? "",
        generationMode: draft.generationMode,
        safetyOverride: input.overrideSafetyGate ? "true" : "false"
      })
    ]
  };
}

export interface UpdateOutreachDraftInput {
  id: string;
  subject?: string;
  body?: string;
  status?: OutreachDraftStatus;
}

export interface UpdateOutreachDraftResult {
  draft: OutreachDraft;
  drafts: OutreachDraft[];
  auditEvents: RecruiterCrmAuditEvent[];
}

export function updateOutreachDraft(
  session: AppSession,
  input: UpdateOutreachDraftInput
): UpdateOutreachDraftResult {
  const existing = loadOutreachDrafts(session);
  const target = existing.find((draft) => draft.id === input.id);
  if (!target) {
    throw new Error(`Outreach draft ${input.id} not found.`);
  }
  const timestamp = nowIso();
  const nextStatus: OutreachDraftStatus =
    input.status ??
    (input.subject !== undefined || input.body !== undefined
      ? "edited"
      : target.status);
  const updated = outreachDraftSchema.parse({
    ...target,
    subject: input.subject ?? target.subject,
    body: input.body ?? target.body,
    status: nextStatus,
    approvedAt: nextStatus === "approved" ? timestamp : target.approvedAt,
    sentManuallyAt:
      nextStatus === "sent_manually" ? timestamp : target.sentManuallyAt,
    updatedAt: timestamp
  });
  const drafts = saveOutreachDrafts(
    session,
    existing.map((draft) => (draft.id === updated.id ? updated : draft))
  );
  const auditEvents: RecruiterCrmAuditEvent[] = [
    audit("outreach_draft_updated", "OutreachDraft", updated.id, {
      type: updated.type,
      status: updated.status,
      jobId: updated.jobId
    })
  ];
  if (target.status !== "approved" && updated.status === "approved") {
    auditEvents.push(
      audit("outreach_draft_approved", "OutreachDraft", updated.id, {
        type: updated.type
      })
    );
  }
  if (target.status !== "sent_manually" && updated.status === "sent_manually") {
    auditEvents.push(
      audit(
        "outreach_draft_sent_manually",
        "OutreachDraft",
        updated.id,
        { type: updated.type }
      )
    );
  }
  return { draft: updated, drafts, auditEvents };
}

export interface CreateFollowUpReminderInput {
  jobId: string;
  applicationRecordId: string | null;
  recruiterContactId: string | null;
  dueAt: string;
  reason: string;
}

export interface CreateFollowUpReminderResult {
  reminder: FollowUpReminder;
  reminders: FollowUpReminder[];
  auditEvents: RecruiterCrmAuditEvent[];
}

export function createFollowUpReminder(
  session: AppSession,
  input: CreateFollowUpReminderInput
): CreateFollowUpReminderResult {
  const timestamp = nowIso();
  const reminder = followUpReminderSchema.parse({
    id: createId("reminder"),
    tenantId: session.tenant.id,
    userId: session.userId,
    jobId: input.jobId,
    applicationRecordId: input.applicationRecordId,
    recruiterContactId: input.recruiterContactId,
    dueAt: input.dueAt,
    reason: input.reason,
    status: "pending" as FollowUpReminderStatus,
    createdAt: timestamp,
    updatedAt: timestamp
  });
  const reminders = saveFollowUpReminders(session, [
    reminder,
    ...loadFollowUpReminders(session)
  ]);
  return {
    reminder,
    reminders,
    auditEvents: [
      audit("follow_up_reminder_created", "FollowUpReminder", reminder.id, {
        jobId: reminder.jobId,
        applicationRecordId: reminder.applicationRecordId ?? "",
        dueAt: reminder.dueAt
      })
    ]
  };
}

export interface UpdateFollowUpReminderInput {
  id: string;
  status?: FollowUpReminderStatus;
  dueAt?: string;
  reason?: string;
}

export function updateFollowUpReminder(
  session: AppSession,
  input: UpdateFollowUpReminderInput
): CreateFollowUpReminderResult {
  const existing = loadFollowUpReminders(session);
  const target = existing.find((reminder) => reminder.id === input.id);
  if (!target) {
    throw new Error(`Follow-up reminder ${input.id} not found.`);
  }
  const timestamp = nowIso();
  const updated = followUpReminderSchema.parse({
    ...target,
    status: input.status ?? target.status,
    dueAt: input.dueAt ?? target.dueAt,
    reason: input.reason ?? target.reason,
    updatedAt: timestamp
  });
  const reminders = saveFollowUpReminders(
    session,
    existing.map((reminder) =>
      reminder.id === updated.id ? updated : reminder
    )
  );
  const auditEvents: RecruiterCrmAuditEvent[] = [
    audit("follow_up_reminder_updated", "FollowUpReminder", updated.id, {
      jobId: updated.jobId,
      status: updated.status
    })
  ];
  if (target.status !== "completed" && updated.status === "completed") {
    auditEvents.push(
      audit("follow_up_reminder_completed", "FollowUpReminder", updated.id, {
        jobId: updated.jobId
      })
    );
  }
  return { reminder: updated, reminders, auditEvents };
}

export interface AddInterviewNoteInput {
  jobId: string;
  applicationRecordId: string | null;
  stage: InterviewStage;
  scheduledAt: string | null;
  interviewerNames: string[];
  notes: string;
  questionsAsked: string[];
  followUps: string[];
}

export interface AddInterviewNoteResult {
  note: InterviewNote;
  notes: InterviewNote[];
  auditEvents: RecruiterCrmAuditEvent[];
}

export function addInterviewNote(
  session: AppSession,
  input: AddInterviewNoteInput
): AddInterviewNoteResult {
  const timestamp = nowIso();
  const note = interviewNoteSchema.parse({
    id: createId("note"),
    tenantId: session.tenant.id,
    userId: session.userId,
    jobId: input.jobId,
    applicationRecordId: input.applicationRecordId,
    stage: input.stage,
    scheduledAt: input.scheduledAt,
    interviewerNames: input.interviewerNames,
    notes: input.notes,
    questionsAsked: input.questionsAsked,
    followUps: input.followUps,
    createdAt: timestamp,
    updatedAt: timestamp
  });
  const notes = saveInterviewNotes(session, [
    note,
    ...loadInterviewNotes(session)
  ]);
  return {
    note,
    notes,
    auditEvents: [
      audit("interview_note_added", "InterviewNote", note.id, {
        jobId: note.jobId,
        applicationRecordId: note.applicationRecordId ?? "",
        stage: note.stage
      })
    ]
  };
}

export function crmForApplication(
  session: AppSession,
  application: ApplicationRecord
): CrmForApplication {
  const contacts = loadRecruiterContacts(session).filter(
    (contact) =>
      contact.applicationRecordId === application.id ||
      (contact.applicationRecordId === null && contact.jobId === application.jobId)
  );
  const drafts = loadOutreachDrafts(session).filter(
    (draft) =>
      draft.applicationRecordId === application.id ||
      (draft.applicationRecordId === null && draft.jobId === application.jobId)
  );
  const reminders = loadFollowUpReminders(session).filter(
    (reminder) =>
      reminder.applicationRecordId === application.id ||
      (reminder.applicationRecordId === null &&
        reminder.jobId === application.jobId)
  );
  const interviewNotes = loadInterviewNotes(session).filter(
    (note) =>
      note.applicationRecordId === application.id ||
      (note.applicationRecordId === null && note.jobId === application.jobId)
  );
  return { contacts, drafts, reminders, interviewNotes };
}

export interface DueRemindersOptions {
  /** When provided, treat this date as "today" — defaults to now. */
  now?: Date;
  /** Look ahead this many days for the "due today" bucket. Default 0 = strictly today. */
  daysAhead?: number;
}

export function dueRemindersToday(
  reminders: FollowUpReminder[],
  options: DueRemindersOptions = {}
): FollowUpReminder[] {
  const now = options.now ?? new Date();
  const daysAhead = options.daysAhead ?? 0;
  const cutoff = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);
  // Compare on the YYYY-MM-DD date portion so timezone offsets within a day
  // don't push reminders out of the bucket.
  const cutoffDay = cutoff.toISOString().slice(0, 10);
  return reminders.filter((reminder) => {
    if (reminder.status !== "pending") return false;
    const dueDay = reminder.dueAt.slice(0, 10);
    return dueDay <= cutoffDay;
  });
}

export type {
  FollowUpReminder,
  InterviewNote,
  OutreachDraft,
  RecruiterContact
} from "../models/domain";
