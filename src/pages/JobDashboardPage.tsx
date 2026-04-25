import {
  AlertTriangle,
  BriefcaseBusiness,
  Layers3,
  RefreshCw,
  Search,
  Sparkles
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { EmptyState } from "../components/EmptyState";
import type {
  ApplicationPackage,
  ApplicationRecord,
  DashboardJobAction,
  JobMatch,
  NormalizedJob,
  ProfileCompletion
} from "../models/domain";

type QueueTab = "apply_review" | "maybe" | "browse";

interface JobDashboardPageProps {
  jobs: NormalizedJob[];
  matches: JobMatch[];
  applications: ApplicationRecord[];
  packages: ApplicationPackage[];
  profileCompletion: ProfileCompletion;
  isScoring: boolean;
  onScoreJobs: () => void;
  onJobAction: (jobId: string, action: DashboardJobAction, notes?: string) => void;
  onOpenPackage: (packageId: string) => void;
}

interface JobCardData {
  job: NormalizedJob;
  match: JobMatch | null;
  application: ApplicationRecord | null;
  applicationPackage: ApplicationPackage | null;
}

const tabs: Array<{
  id: QueueTab;
  label: string;
  icon: typeof BriefcaseBusiness;
  title: string;
  message: string;
}> = [
  {
    id: "apply_review",
    label: "Apply Review",
    icon: BriefcaseBusiness,
    title: "No high-match jobs yet",
    message:
      "Jobs scoring 8.0 or higher will appear here for human review and next-step decisions."
  },
  {
    id: "maybe",
    label: "Maybe",
    icon: Layers3,
    title: "No medium-match jobs yet",
    message:
      "Jobs scoring 5.5 to 7.9 will appear here with gaps to inspect before investing effort."
  },
  {
    id: "browse",
    label: "Browse",
    icon: Search,
    title: "No browsable jobs yet",
    message:
      "Low-score and skipped jobs remain visible here instead of being hidden."
  }
];

function scoreTone(score: number): string {
  if (score >= 8) {
    return "bg-emerald-50 text-emerald-700";
  }

  if (score >= 5.5) {
    return "bg-amber-50 text-amber-700";
  }

  return "bg-slate-100 text-slate-700";
}

function recommendationLabel(match: JobMatch): string {
  if (match.recommendation === "apply") {
    return "Apply review";
  }

  if (match.recommendation === "maybe") {
    return "Maybe";
  }

  if (match.recommendation === "skip") {
    return "Skip";
  }

  return "Browse";
}

function applicationStatusLabel(application: ApplicationRecord | null): string {
  return application ? application.status.replace(/_/g, " ") : "not tracked";
}

function packageStatusLabel(applicationPackage: ApplicationPackage | null): string {
  return applicationPackage
    ? applicationPackage.status.replace(/_/g, " ")
    : "no package";
}

function userFacingJobCopy(value: string): string {
  return value
    .split("Manual import queued for normalization")
    .join("Manually imported job")
    .split("A crawler or parser will normalize this posting in a later phase.")
    .join(
      "Details are limited, so scoring confidence may be lower until the posting is enriched."
    );
}

function confirmSensitiveAction(action: DashboardJobAction): boolean {
  if (action === "archive") {
    return window.confirm("Archive this job in your tracker?");
  }

  if (action === "reject" || action === "mark_not_interested") {
    return window.confirm("Mark this job as not moving forward?");
  }

  return true;
}

function ActionButton({
  label,
  action,
  jobId,
  onJobAction,
  notes,
  variant = "secondary"
}: {
  label: string;
  action: DashboardJobAction;
  jobId: string;
  onJobAction: (jobId: string, action: DashboardJobAction, notes?: string) => void;
  notes?: string;
  variant?: "primary" | "secondary" | "danger";
}) {
  const className =
    variant === "primary"
      ? "border-ink bg-ink text-white hover:bg-slate-700"
      : variant === "danger"
        ? "border-red-200 bg-red-50 text-red-700 hover:bg-red-100"
        : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50";

  return (
    <button
      className={`inline-flex min-h-9 items-center justify-center rounded-md border px-3 text-xs font-semibold transition ${className}`}
      type="button"
      onClick={() => {
        if (confirmSensitiveAction(action)) {
          onJobAction(jobId, action, notes);
        }
      }}
    >
      {label}
    </button>
  );
}

function JobMatchCard({
  item,
  onJobAction,
  onOpenPackage
}: {
  item: JobCardData;
  onJobAction: (jobId: string, action: DashboardJobAction, notes?: string) => void;
  onOpenPackage: (packageId: string) => void;
}) {
  const { job, match, application, applicationPackage } = item;
  const [notesDraft, setNotesDraft] = useState(application?.notes ?? "");

  useEffect(() => {
    setNotesDraft(application?.notes ?? "");
  }, [application?.notes]);

  if (!match) {
    return (
      <article className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-slate-950">
              {userFacingJobCopy(job.title)}
            </h3>
            <p className="mt-1 text-sm text-slate-500">
              {job.company} · {job.location || "Unknown location"}
            </p>
          </div>
          <span className="inline-flex w-fit rounded-md bg-sky-50 px-2 py-1 text-xs font-semibold text-sky-700">
            Queued
          </span>
          {applicationPackage && (
            <span className="inline-flex w-fit rounded-md bg-purple-50 px-2 py-1 text-xs font-semibold capitalize text-purple-700">
              Package {packageStatusLabel(applicationPackage)}
            </span>
          )}
        </div>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          This job has been ingested and is waiting for match scoring.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <ActionButton
            label="Save for later"
            action="save_for_later"
            jobId={job.id}
            onJobAction={onJobAction}
          />
          {applicationPackage && (
            <button
              className="inline-flex min-h-9 items-center justify-center rounded-md border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
              type="button"
              onClick={() => onOpenPackage(applicationPackage.id)}
            >
              Review package
            </button>
          )}
          <ActionButton
            label="Archive"
            action="archive"
            jobId={job.id}
            onJobAction={onJobAction}
            variant="danger"
          />
        </div>
      </article>
    );
  }

  const lowMatch = match.queue === "browse" && match.overallScore < 5.5;

  return (
    <article className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-slate-950">
            {userFacingJobCopy(job.title)}
          </h3>
          <p className="mt-1 text-sm text-slate-500">
            {job.company} · {job.location || "Unknown location"}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <span
            className={`inline-flex rounded-md px-2 py-1 text-xs font-semibold ${scoreTone(match.overallScore)}`}
          >
            {match.overallScore.toFixed(1)} / 10
          </span>
          <span className="inline-flex rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">
            {recommendationLabel(match)}
          </span>
          <span className="inline-flex rounded-md bg-blue-50 px-2 py-1 text-xs font-semibold capitalize text-blue-700">
            {applicationStatusLabel(application)}
          </span>
          {applicationPackage && (
            <span className="inline-flex rounded-md bg-purple-50 px-2 py-1 text-xs font-semibold capitalize text-purple-700">
              Package {packageStatusLabel(applicationPackage)}
            </span>
          )}
        </div>
      </div>

      <p className="mt-4 text-sm leading-6 text-slate-700">
        {userFacingJobCopy(match.summary)}
      </p>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div>
          <h4 className="text-sm font-semibold text-slate-900">Top match reasons</h4>
          <ul className="mt-2 space-y-2 text-sm leading-5 text-slate-600">
            {match.topMatchReasons.slice(0, 3).map((reason) => (
              <li key={reason}>- {reason}</li>
            ))}
          </ul>
        </div>
        <div>
          <h4 className="text-sm font-semibold text-slate-900">
            {lowMatch ? "Why this is low match" : "Top gaps"}
          </h4>
          <ul className="mt-2 space-y-2 text-sm leading-5 text-slate-600">
            {match.topGaps.slice(0, 3).map((gap) => (
              <li key={gap}>- {gap}</li>
            ))}
          </ul>
        </div>
      </div>

      <div className="mt-4 rounded-md border border-slate-200 bg-panel p-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Recommended next action
        </p>
        <p className="mt-1 text-sm leading-6 text-slate-700">
          {match.recommendedNextAction}
        </p>
      </div>

      <div className="mt-4 rounded-md border border-slate-200 p-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Actions
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <ActionButton
            label="Save for later"
            action="save_for_later"
            jobId={job.id}
            onJobAction={onJobAction}
          />
          <ActionButton
            label="Move to Apply Review"
            action="move_to_apply_review"
            jobId={job.id}
            onJobAction={onJobAction}
            variant={match.queue === "apply_review" ? "primary" : "secondary"}
          />
          <ActionButton
            label="Move to Maybe"
            action="move_to_maybe"
            jobId={job.id}
            onJobAction={onJobAction}
            variant={match.queue === "maybe" ? "primary" : "secondary"}
          />
          <ActionButton
            label="Start application prep"
            action="start_application_prep"
            jobId={job.id}
            onJobAction={onJobAction}
            variant="primary"
          />
          {applicationPackage && (
            <button
              className="inline-flex min-h-9 items-center justify-center rounded-md border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
              type="button"
              onClick={() => onOpenPackage(applicationPackage.id)}
            >
              Review package
            </button>
          )}
          <ActionButton
            label="Mark manually applied"
            action="mark_manually_applied"
            jobId={job.id}
            onJobAction={onJobAction}
          />
          <ActionButton
            label="Mark not interested"
            action="mark_not_interested"
            jobId={job.id}
            onJobAction={onJobAction}
            variant="danger"
          />
          <ActionButton
            label="Reject"
            action="reject"
            jobId={job.id}
            onJobAction={onJobAction}
            variant="danger"
          />
          <ActionButton
            label="Archive"
            action="archive"
            jobId={job.id}
            onJobAction={onJobAction}
            variant="danger"
          />
        </div>

        <label className="mt-4 block space-y-2">
          <span className="text-sm font-medium text-slate-700">Notes</span>
          <textarea
            className="min-h-20 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm leading-6 text-slate-900"
            value={notesDraft}
            onChange={(event) => setNotesDraft(event.target.value)}
            placeholder="Add private job-search notes"
          />
        </label>
        <button
          className="mt-2 inline-flex min-h-9 items-center justify-center rounded-md border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
          type="button"
          onClick={() => onJobAction(job.id, "update_notes", notesDraft)}
        >
          Save notes
        </button>
      </div>
    </article>
  );
}

export function JobDashboardPage({
  jobs,
  matches,
  applications,
  packages,
  profileCompletion,
  isScoring,
  onScoreJobs,
  onJobAction,
  onOpenPackage
}: JobDashboardPageProps) {
  const [activeTab, setActiveTab] = useState<QueueTab>("apply_review");
  const selected = tabs.find((tab) => tab.id === activeTab) ?? tabs[0];
  const matchByJobId = useMemo(
    () => new Map(matches.map((match) => [match.jobId, match] as const)),
    [matches]
  );
  const applicationByJobId = useMemo(
    () =>
      new Map(
        applications.map((application) => [application.jobId, application] as const)
      ),
    [applications]
  );
  const packageByJobId = useMemo(
    () =>
      new Map(
        packages.map((applicationPackage) => [
          applicationPackage.jobId,
          applicationPackage
        ] as const)
      ),
    [packages]
  );
  const queuedJobs = jobs.filter((job) => !matchByJobId.has(job.id));
  const cards = useMemo<JobCardData[]>(() => {
    const matchedCards = jobs
      .map((job) => ({
        job,
        match: matchByJobId.get(job.id) ?? null,
        application: applicationByJobId.get(job.id) ?? null,
        applicationPackage: packageByJobId.get(job.id) ?? null
      }))
      .filter((item) => item.match !== null)
      .sort((a, b) => (b.match?.overallScore ?? 0) - (a.match?.overallScore ?? 0));

    if (activeTab === "browse") {
      return [
        ...matchedCards.filter((item) => item.match?.queue === "browse"),
        ...queuedJobs.map((job) => ({
          job,
          match: null,
          application: applicationByJobId.get(job.id) ?? null,
          applicationPackage: packageByJobId.get(job.id) ?? null
        }))
      ];
    }

    return matchedCards.filter((item) => item.match?.queue === activeTab);
  }, [activeTab, applicationByJobId, jobs, matchByJobId, packageByJobId, queuedJobs]);

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-3xl">
          <p className="text-sm font-semibold uppercase tracking-wide text-emerald-700">
            Jobs
          </p>
          <h2 className="mt-2 text-3xl font-semibold text-slate-950">
            Job dashboard
          </h2>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            Scored jobs are routed into queues for human review. Low-score jobs stay
            browsable with explanations.
          </p>
        </div>
        <button
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-ink px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-400"
          type="button"
          disabled={isScoring || jobs.length === 0}
          onClick={onScoreJobs}
        >
          {isScoring ? (
            <RefreshCw className="animate-spin" aria-hidden="true" size={18} />
          ) : (
            <Sparkles aria-hidden="true" size={18} />
          )}
          {isScoring ? "Scoring jobs" : "Score jobs now"}
        </button>
      </header>

      {profileCompletion.percent < 100 && (
        <div className="flex gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-800">
          <AlertTriangle aria-hidden="true" className="mt-0.5 shrink-0" size={18} />
          <p>
            Profile is {profileCompletion.percent}% complete. Scoring will still run
            as a best-effort estimate, but missing fields can lower confidence.
          </p>
        </div>
      )}

      <section className="rounded-lg border border-line bg-white p-5 shadow-soft">
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Job queues">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const active = tab.id === activeTab;
            const count =
              tab.id === "browse"
                ? jobs.filter((job) => {
                    const match = matchByJobId.get(job.id);
                    return !match || match.queue === "browse";
                  }).length
                : matches.filter((match) => match.queue === tab.id).length;

            return (
              <button
                key={tab.id}
                className={`inline-flex min-h-10 items-center gap-2 rounded-md px-3 text-sm font-semibold transition ${
                  active
                    ? "bg-ink text-white"
                    : "border border-slate-300 text-slate-700 hover:bg-slate-50"
                }`}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setActiveTab(tab.id)}
              >
                <Icon aria-hidden="true" size={17} />
                {tab.label}
                <span className="rounded bg-white/20 px-1.5 py-0.5 text-xs">
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        <div className="mt-5" role="tabpanel">
          {cards.length > 0 ? (
            <div className="space-y-4">
              {cards.map((item) => (
                <JobMatchCard
                  key={item.job.id}
                  item={item}
                  onJobAction={onJobAction}
                  onOpenPackage={onOpenPackage}
                />
              ))}
            </div>
          ) : (
            <EmptyState
              icon={selected.icon}
              title={selected.title}
              message={selected.message}
            />
          )}
        </div>
      </section>
    </div>
  );
}
