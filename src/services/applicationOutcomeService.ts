import type {
  AppSession,
  ApplicationOutcome,
  ApplicationOutcomeStatus,
  ApplicationRecord,
  ApplicationStatus
} from "../models/domain";
import { applicationOutcomeSchema } from "../models/schemas";
import { readJson, scopedKey, writeJson } from "../lib/storage";

function createId(prefix: string): string {
  return `${prefix}_${globalThis.crypto.randomUUID()}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function outcomesKey(session: AppSession): string {
  return scopedKey(session.tenant.id, session.userId, "application_outcomes");
}

export function loadApplicationOutcomes(session: AppSession): ApplicationOutcome[] {
  const outcomes = readJson<ApplicationOutcome[]>(outcomesKey(session), []);
  return outcomes.filter((outcome) => applicationOutcomeSchema.safeParse(outcome).success);
}

export function saveApplicationOutcomes(
  session: AppSession,
  outcomes: ApplicationOutcome[]
): ApplicationOutcome[] {
  const parsed = outcomes.map((outcome) => applicationOutcomeSchema.parse(outcome));
  writeJson(outcomesKey(session), parsed.slice(0, 500));
  return parsed;
}

export function outcomeForApplicationStatus(
  status: ApplicationStatus
): ApplicationOutcomeStatus | null {
  if (status === "submitted") {
    return "submitted";
  }

  if (status === "recruiter_contacted") {
    return "recruiter_response";
  }

  if (status === "interviewing") {
    return "interview_scheduled";
  }

  if (status === "rejected") {
    return "rejected";
  }

  if (status === "offer") {
    return "offer";
  }

  if (status === "withdrawn") {
    return "withdrawn";
  }

  return null;
}

export function recordApplicationOutcome(
  session: AppSession,
  application: ApplicationRecord,
  outcome: ApplicationOutcomeStatus,
  notes = ""
): ApplicationOutcome {
  const timestamp = nowIso();
  const existing = loadApplicationOutcomes(session).find(
    (item) =>
      item.applicationRecordId === application.id && item.outcome === outcome
  );
  const next = applicationOutcomeSchema.parse({
    id: existing?.id ?? createId("outcome"),
    tenantId: session.tenant.id,
    userId: session.userId,
    applicationRecordId: application.id,
    jobId: application.jobId,
    outcome,
    outcomeDate: timestamp,
    notes: notes || existing?.notes || "",
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp
  });
  const outcomes = loadApplicationOutcomes(session);
  const saved = existing
    ? outcomes.map((item) => (item.id === next.id ? next : item))
    : [next, ...outcomes];

  saveApplicationOutcomes(session, saved);
  return next;
}

export function summarizeApplicationOutcomes(
  outcomes: ApplicationOutcome[]
): Record<string, number> {
  return outcomes.reduce<Record<string, number>>((counts, outcome) => {
    counts[outcome.outcome] = (counts[outcome.outcome] ?? 0) + 1;
    return counts;
  }, {});
}
