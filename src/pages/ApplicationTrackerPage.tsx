import { Bot, ClipboardList } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { EmptyState } from "../components/EmptyState";
import type {
  BrowserApplicationSession,
  ApplicationPackage,
  ApplicationRecord,
  ApplicationStatus,
  JobMatch,
  NormalizedJob
} from "../models/domain";
import { applicationStatuses } from "../models/domain";

interface ApplicationTrackerPageProps {
  applications: ApplicationRecord[];
  jobs: NormalizedJob[];
  matches: JobMatch[];
  packages: ApplicationPackage[];
  browserSessions: BrowserApplicationSession[];
  onStatusChange: (applicationId: string, status: ApplicationStatus) => void;
  onNotesChange: (applicationId: string, notes: string) => void;
  onOpenPackage: (packageId: string) => void;
  onOpenBrowserSession: (sessionId: string) => void;
}

function statusLabel(status: string): string {
  return status.replace(/_/g, " ");
}

function statusDescription(status: ApplicationStatus): string {
  switch (status) {
    case "saved":
      return "Held for later review.";
    case "draft_prepared":
      return "Application prep has started and is waiting for review.";
    case "needs_review":
      return "Waiting for human review.";
    case "submitted":
      return "Marked as manually applied by the user.";
    case "rejected":
      return "Not moving forward, still retained for history.";
    case "offer":
      return "Offer received.";
    case "withdrawn":
      return "Withdrawn by the user.";
    case "archived":
      return "Archived but not deleted.";
    default:
      return "Tracked application workflow state.";
  }
}

function userFacingJobCopy(value: string): string {
  if (value.toLowerCase().includes("manual import queued")) {
    return "Manually imported job";
  }

  if (value.toLowerCase().includes("normalize this posting")) {
    return "Details are limited, so scoring confidence may be lower until the posting is enriched.";
  }

  return value;
}

function packageStatusMessage(applicationPackage: ApplicationPackage): string {
  if (
    applicationPackage.status === "draft" ||
    applicationPackage.status === "ready_for_review"
  ) {
    return "Application package is ready for review and edits.";
  }

  if (applicationPackage.status === "approved") {
    return "Application package is ready for browser application assistant.";
  }

  return "Application package needs review or regenerate before applying.";
}

function browserSessionMessage(browserSession: BrowserApplicationSession): string {
  if (browserSession.status === "submitted") {
    return "Browser assistant confirmed submission.";
  }

  if (browserSession.status === "manual_required") {
    return "Browser assistant marked this application for manual completion.";
  }

  if (browserSession.status === "approved_for_submit") {
    return "Submit was approved and is waiting for the assistant submit action.";
  }

  if (browserSession.status === "ready_for_review") {
    return "Browser session is ready for final human review.";
  }

  if (browserSession.status === "needs_user_input") {
    return "Browser session is paused for human input.";
  }

  return "Browser session is in progress.";
}

function TrackerCard({
  application,
  job,
  match,
  applicationPackage,
  browserSession,
  onStatusChange,
  onNotesChange,
  onOpenPackage,
  onOpenBrowserSession
}: {
  application: ApplicationRecord;
  job: NormalizedJob | null;
  match: JobMatch | null;
  applicationPackage: ApplicationPackage | null;
  browserSession: BrowserApplicationSession | null;
  onStatusChange: (applicationId: string, status: ApplicationStatus) => void;
  onNotesChange: (applicationId: string, notes: string) => void;
  onOpenPackage: (packageId: string) => void;
  onOpenBrowserSession: (sessionId: string) => void;
}) {
  const [notesDraft, setNotesDraft] = useState(application.notes);

  useEffect(() => {
    setNotesDraft(application.notes);
  }, [application.notes]);

  return (
    <article className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <h4 className="text-base font-semibold text-slate-950">
            {job ? userFacingJobCopy(job.title) : application.jobId}
          </h4>
          <p className="mt-1 text-sm text-slate-500">
            {job ? `${job.company} · ${job.location || "Unknown location"}` : "Job not found"}
          </p>
          <p className="mt-1 text-xs uppercase tracking-wide text-slate-500">
            Updated {new Date(application.updatedAt).toLocaleString()}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {match && (
            <span className="rounded-md bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700">
              {match.overallScore.toFixed(1)} / 10
            </span>
          )}
          <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold capitalize text-slate-700">
            {statusLabel(application.status)}
          </span>
          {applicationPackage && (
            <span className="rounded-md bg-purple-50 px-2 py-1 text-xs font-semibold capitalize text-purple-700">
              Package {statusLabel(applicationPackage.status)}
            </span>
          )}
          {browserSession && (
            <span className="rounded-md bg-emerald-50 px-2 py-1 text-xs font-semibold capitalize text-emerald-700">
              Browser {statusLabel(browserSession.status)}
            </span>
          )}
        </div>
      </div>

      {match && (
        <p className="mt-3 text-sm leading-6 text-slate-600">
          {userFacingJobCopy(match.summary)}
        </p>
      )}

      {applicationPackage && (
        <div className="mt-4 flex flex-col gap-3 rounded-md border border-slate-200 bg-panel p-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm leading-6 text-slate-600">
            {packageStatusMessage(applicationPackage)}
          </p>
          <button
            className="inline-flex min-h-9 items-center justify-center rounded-md border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
            type="button"
            onClick={() => onOpenPackage(applicationPackage.id)}
          >
            Review package
          </button>
        </div>
      )}

      {browserSession && (
        <div className="mt-4 flex flex-col gap-3 rounded-md border border-emerald-200 bg-emerald-50 p-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm leading-6 text-emerald-800">
            {browserSessionMessage(browserSession)}
          </p>
          <button
            className="inline-flex min-h-9 items-center justify-center gap-2 rounded-md border border-emerald-200 bg-white px-3 text-xs font-semibold text-emerald-800 transition hover:bg-emerald-100"
            type="button"
            onClick={() => onOpenBrowserSession(browserSession.id)}
          >
            <Bot aria-hidden="true" size={15} />
            Open browser session
          </button>
        </div>
      )}

      <div className="mt-4 grid gap-3 md:grid-cols-[220px_1fr_auto] md:items-end">
        <label className="space-y-2">
          <span className="text-sm font-medium text-slate-700">Status</span>
          <select
            className="min-h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm capitalize text-slate-950 shadow-sm"
            value={application.status}
            onChange={(event) =>
              onStatusChange(application.id, event.target.value as ApplicationStatus)
            }
          >
            {applicationStatuses.map((status) => (
              <option key={status} value={status}>
                {statusLabel(status)}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-2">
          <span className="text-sm font-medium text-slate-700">Notes</span>
          <textarea
            className="min-h-10 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm leading-6 text-slate-900 shadow-sm"
            value={notesDraft}
            onChange={(event) => setNotesDraft(event.target.value)}
            placeholder="Add private notes"
          />
        </label>

        <button
          className="inline-flex min-h-10 items-center justify-center rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          type="button"
          onClick={() => onNotesChange(application.id, notesDraft)}
        >
          Save notes
        </button>
      </div>
    </article>
  );
}

export function ApplicationTrackerPage({
  applications,
  jobs,
  matches,
  packages,
  browserSessions,
  onStatusChange,
  onNotesChange,
  onOpenPackage,
  onOpenBrowserSession
}: ApplicationTrackerPageProps) {
  const jobById = useMemo(
    () => new Map(jobs.map((job) => [job.id, job] as const)),
    [jobs]
  );
  const matchByJobId = useMemo(
    () => new Map(matches.map((match) => [match.jobId, match] as const)),
    [matches]
  );
  const packageByApplicationId = useMemo(
    () =>
      new Map(
        packages.map((applicationPackage) => [
          applicationPackage.applicationRecordId,
          applicationPackage
        ] as const)
      ),
    [packages]
  );
  const browserSessionByApplicationId = useMemo(
    () => {
      const latest = new Map<string, BrowserApplicationSession>();
      browserSessions
        .slice()
        .sort(
          (a, b) =>
            new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        )
        .forEach((browserSession) => {
          if (!latest.has(browserSession.applicationRecordId)) {
            latest.set(browserSession.applicationRecordId, browserSession);
          }
        });
      return latest;
    },
    [browserSessions]
  );
  const grouped = applicationStatuses
    .map((status) => ({
      status,
      applications: applications
        .filter((application) => application.status === status)
        .sort(
          (a, b) =>
            new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        )
    }))
    .filter((group) => group.applications.length > 0);

  return (
    <div className="space-y-6">
      <header className="max-w-3xl">
        <p className="text-sm font-semibold uppercase tracking-wide text-emerald-700">
          Tracker
        </p>
        <h2 className="mt-2 text-3xl font-semibold text-slate-950">
          Application tracker
        </h2>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          Track saved jobs, prep work, manual applications, interviews, outcomes, and
          archived records without deleting job history.
        </p>
      </header>

      {applications.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="No applications tracked"
          message="Use dashboard actions to save, reject, archive, start prep, or mark a manual application."
        />
      ) : (
        <div className="space-y-5">
          {grouped.map((group) => (
            <section
              key={group.status}
              className="rounded-lg border border-line bg-white p-5 shadow-soft"
            >
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h3 className="text-base font-semibold capitalize text-slate-950">
                    {statusLabel(group.status)}
                  </h3>
                  <p className="mt-1 text-sm text-slate-500">
                    {statusDescription(group.status)}
                  </p>
                </div>
                <span className="rounded-md bg-slate-100 px-2 py-1 text-sm font-semibold text-slate-700">
                  {group.applications.length}
                </span>
              </div>

              <div className="mt-4 space-y-3">
                {group.applications.map((application) => (
                  <TrackerCard
                    key={application.id}
                    application={application}
                    job={jobById.get(application.jobId) ?? null}
                    match={matchByJobId.get(application.jobId) ?? null}
                    applicationPackage={
                      packageByApplicationId.get(application.id) ?? null
                    }
                    browserSession={
                      browserSessionByApplicationId.get(application.id) ?? null
                    }
                    onStatusChange={onStatusChange}
                    onNotesChange={onNotesChange}
                    onOpenPackage={onOpenPackage}
                    onOpenBrowserSession={onOpenBrowserSession}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
