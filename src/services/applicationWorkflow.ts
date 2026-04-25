import type {
  AppSession,
  ApplicationRecord,
  ApplicationStatus,
  DashboardJobAction,
  JobMatch,
  MatchRecommendation,
  QueueType
} from "../models/domain";
import { jobMatchSchema } from "../models/schemas";
import {
  loadApplications,
  upsertApplicationRecord
} from "./applicationService";
import { loadJobMatches, saveJobMatches } from "./matchEngine";

export interface DashboardActionResult {
  application: ApplicationRecord;
  applications: ApplicationRecord[];
  matches: JobMatch[];
  auditAction: string;
  auditMetadata: Record<string, string | number | boolean | null>;
}

function queueToRecommendation(queue: QueueType): MatchRecommendation {
  if (queue === "apply_review") {
    return "apply";
  }

  if (queue === "maybe") {
    return "maybe";
  }

  return "browse";
}

function statusForAction(action: DashboardJobAction): ApplicationStatus {
  switch (action) {
    case "save_for_later":
      return "saved";
    case "reject":
    case "mark_not_interested":
      return "rejected";
    case "archive":
      return "archived";
    case "move_to_apply_review":
    case "move_to_maybe":
      return "recommended";
    case "start_application_prep":
      return "draft_prepared";
    case "mark_manually_applied":
      return "submitted";
    case "update_notes":
      return "discovered";
    default:
      return "discovered";
  }
}

function auditActionFor(action: DashboardJobAction): string {
  switch (action) {
    case "save_for_later":
      return "job_saved";
    case "reject":
      return "job_rejected";
    case "archive":
      return "job_archived";
    case "move_to_apply_review":
      return "job_promoted_to_apply_review";
    case "move_to_maybe":
      return "job_moved_to_maybe";
    case "start_application_prep":
      return "application_prep_started";
    case "update_notes":
      return "application_note_updated";
    case "mark_manually_applied":
      return "manually_applied";
    case "mark_not_interested":
      return "job_marked_not_interested";
    default:
      return "application_status_changed";
  }
}

function queueForAction(action: DashboardJobAction): QueueType | null {
  if (action === "move_to_apply_review") {
    return "apply_review";
  }

  if (action === "move_to_maybe") {
    return "maybe";
  }

  return null;
}

export function updateMatchQueue(
  session: AppSession,
  jobId: string,
  queue: QueueType
): JobMatch[] {
  const matches = loadJobMatches(session);
  const existing = matches.find((match) => match.jobId === jobId);
  if (!existing) {
    return matches;
  }

  const updated = jobMatchSchema.parse({
    ...existing,
    queue,
    recommendation: queueToRecommendation(queue),
    recommendedNextAction:
      queue === "apply_review"
        ? "User override: review this job in Apply Review before any application work."
        : queue === "maybe"
          ? "User override: keep this job in Maybe for later review."
          : existing.recommendedNextAction,
    updatedAt: new Date().toISOString()
  });

  return saveJobMatches(
    session,
    matches.map((match) => (match.id === updated.id ? updated : match))
  );
}

export function applyDashboardJobAction(
  session: AppSession,
  jobId: string,
  action: DashboardJobAction,
  options: {
    notes?: string;
  } = {}
): DashboardActionResult {
  const existing = loadApplications(session).find(
    (application) => application.jobId === jobId
  );
  const status =
    action === "update_notes" && existing ? existing.status : statusForAction(action);
  const application = upsertApplicationRecord(session, jobId, {
    status,
    notes: options.notes ?? existing?.notes
  });
  const queue = queueForAction(action);
  const matches = queue ? updateMatchQueue(session, jobId, queue) : loadJobMatches(session);

  return {
    application,
    applications: loadApplications(session),
    matches,
    auditAction: auditActionFor(action),
    auditMetadata: {
      jobId,
      status: application.status,
      action,
      queue: queue ?? null,
      notesLength: application.notes.length
    }
  };
}

export function changeApplicationStatus(
  session: AppSession,
  applicationId: string,
  status: ApplicationStatus
): DashboardActionResult {
  const existing = loadApplications(session).find(
    (application) => application.id === applicationId
  );
  if (!existing) {
    throw new Error("Application record was not found.");
  }

  const application = upsertApplicationRecord(session, existing.jobId, { status });

  return {
    application,
    applications: loadApplications(session),
    matches: loadJobMatches(session),
    auditAction:
      status === "submitted" ? "manually_applied" : "application_status_changed",
    auditMetadata: {
      jobId: application.jobId,
      status: application.status,
      previousStatus: existing.status
    }
  };
}

export function changeApplicationNotes(
  session: AppSession,
  applicationId: string,
  notes: string
): DashboardActionResult {
  const existing = loadApplications(session).find(
    (application) => application.id === applicationId
  );
  if (!existing) {
    throw new Error("Application record was not found.");
  }

  const application = upsertApplicationRecord(session, existing.jobId, { notes });

  return {
    application,
    applications: loadApplications(session),
    matches: loadJobMatches(session),
    auditAction: "application_note_updated",
    auditMetadata: {
      jobId: application.jobId,
      status: application.status,
      notesLength: application.notes.length
    }
  };
}
