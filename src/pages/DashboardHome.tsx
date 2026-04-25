import {
  ArrowRight,
  BriefcaseBusiness,
  ClipboardList,
  DatabaseZap,
  FileUp,
  ListChecks,
  RotateCcw,
  UserRound
} from "lucide-react";
import type {
  ApplicationRecord,
  AuditLog,
  JobMatch,
  NormalizedJob,
  ProfileCompletion,
  Resume
} from "../models/domain";
import { CompletionMeter } from "../components/CompletionMeter";
import { ResumeStatusCard } from "../components/ResumeStatusCard";

interface DashboardHomeProps<RouteId extends string> {
  completion: ProfileCompletion;
  resume: Resume | null;
  applications: ApplicationRecord[];
  jobs: NormalizedJob[];
  matches: JobMatch[];
  sourceConfigCount: number;
  auditLogs: AuditLog[];
  isScoring: boolean;
  onScoreJobs: () => void;
  onClearWorkspace?: () => void;
  onNavigate: (route: RouteId) => void;
  routes: {
    profile: RouteId;
    resume: RouteId;
    ingestion: RouteId;
    jobs: RouteId;
    tracker: RouteId;
  };
}

interface RecommendedStep<RouteId extends string> {
  title: string;
  message: string;
  actionLabel: string;
  icon: typeof UserRound;
  action: "navigate" | "score";
  route?: RouteId;
}

function StatCard({
  label,
  value,
  icon: Icon
}: {
  label: string;
  value: string;
  icon: typeof UserRound;
}) {
  return (
    <div className="rounded-lg border border-line bg-white p-5 shadow-soft">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-slate-500">{label}</p>
          <p className="mt-2 text-2xl font-semibold text-slate-950">{value}</p>
        </div>
        <div className="flex h-11 w-11 items-center justify-center rounded-md bg-sky-50 text-sky-700">
          <Icon aria-hidden="true" size={22} />
        </div>
      </div>
    </div>
  );
}

function activityLabel(action: string): string {
  const labels: Record<string, string> = {
    "profile.saved": "Profile saved",
    "resume.uploaded": "Resume uploaded",
    "resume.placeholder_created": "Resume record created",
    "job_source_config.saved": "Job source saved",
    "manual_job_url.imported": "Job URL imported",
    "job_scan.succeeded": "Job scan completed",
    "job_scan.failed": "Job scan failed",
    "job_scoring.completed": "Job matching completed",
    job_saved: "Job saved",
    job_rejected: "Job rejected",
    job_archived: "Job archived",
    job_promoted_to_apply_review: "Moved to Apply Review",
    job_moved_to_maybe: "Moved to Maybe",
    application_prep_started: "Application prep started",
    application_status_changed: "Application status changed",
    application_note_updated: "Application notes updated",
    manually_applied: "Marked as manually applied",
    job_marked_not_interested: "Marked not interested",
    application_package_generated: "Application package generated",
    application_package_edited: "Application package edited",
    application_package_approved: "Application package approved",
    application_package_rejected: "Application package rejected",
    application_answer_edited: "Application answer edited",
    unsupported_claim_warning_created: "Unsupported-claim warning created"
  };

  return labels[action] ?? action.replace(/[._]/g, " ");
}

function getRecommendedStep<RouteId extends string>({
  completion,
  resume,
  jobs,
  matches,
  applications,
  sourceConfigCount,
  routes
}: Pick<
  DashboardHomeProps<RouteId>,
  | "completion"
  | "resume"
  | "jobs"
  | "matches"
  | "applications"
  | "sourceConfigCount"
  | "routes"
>): RecommendedStep<RouteId> {
  const hasQueuedJobs = jobs.some((job) => job.scoringStatus === "queued");
  const hasReviewableMatches = matches.length > 0;
  const hasActivePrep = applications.some((application) =>
    ["draft_prepared", "needs_review"].includes(application.status)
  );

  if (completion.percent < 100) {
    return {
      title: "Complete profile",
      message:
        "Finish your onboarding basics so matching has enough signal to compare roles.",
      actionLabel: "Continue profile",
      icon: UserRound,
      action: "navigate",
      route: routes.profile
    };
  }

  if (!resume) {
    return {
      title: "Upload resume",
      message:
        "Add a resume record so verified experience can support scoring and prep work.",
      actionLabel: "Open resume upload",
      icon: FileUp,
      action: "navigate",
      route: routes.resume
    };
  }

  if (sourceConfigCount === 0 && jobs.length === 0) {
    return {
      title: "Add job source",
      message:
        "Connect a public job board or import a job URL to start building your job list.",
      actionLabel: "Open ingestion",
      icon: DatabaseZap,
      action: "navigate",
      route: routes.ingestion
    };
  }

  if (hasQueuedJobs || (jobs.length > 0 && matches.length === 0)) {
    return {
      title: "Run scoring",
      message:
        "Score ingested jobs against your profile and route them into review queues.",
      actionLabel: "Score jobs now",
      icon: BriefcaseBusiness,
      action: "score"
    };
  }

  if (hasActivePrep) {
    return {
      title: "Continue application prep",
      message:
        "Resume prepared application work and keep every submission under human control.",
      actionLabel: "Open tracker",
      icon: ClipboardList,
      action: "navigate",
      route: routes.tracker
    };
  }

  if (hasReviewableMatches) {
    return {
      title: "Review jobs",
      message:
        "Open your queues, inspect match reasons and gaps, then choose the next action.",
      actionLabel: "Open job queues",
      icon: ClipboardList,
      action: "navigate",
      route: routes.jobs
    };
  }

  return {
    title: "Add job source",
    message: "Bring jobs into the workspace to start matching.",
    actionLabel: "Open ingestion",
    icon: DatabaseZap,
    action: "navigate",
    route: routes.ingestion
  };
}

export function DashboardHome<RouteId extends string>({
  completion,
  resume,
  applications,
  jobs,
  matches,
  sourceConfigCount,
  auditLogs,
  isScoring,
  onScoreJobs,
  onClearWorkspace,
  onNavigate,
  routes
}: DashboardHomeProps<RouteId>) {
  const queuedJobs = jobs.filter((job) => job.scoringStatus === "queued").length;
  const applyCount = matches.filter((match) => match.recommendation === "apply").length;
  const maybeCount = matches.filter((match) => match.recommendation === "maybe").length;
  const browseCount = matches.filter(
    (match) => match.recommendation === "browse" || match.recommendation === "skip"
  ).length;
  const recommendedStep = getRecommendedStep({
    completion,
    resume,
    jobs,
    matches,
    applications,
    sourceConfigCount,
    routes
  });
  const RecommendedIcon = recommendedStep.icon;

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-emerald-700">
            Dashboard
          </p>
          <h2 className="mt-2 text-3xl font-semibold text-slate-950">
            Review center
          </h2>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
            Review matched jobs, decide next actions, and keep every application
            step under human approval.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400"
            type="button"
            disabled={isScoring || jobs.length === 0}
            onClick={onScoreJobs}
          >
            <BriefcaseBusiness aria-hidden="true" size={18} />
            {isScoring ? "Scoring" : "Score jobs now"}
          </button>
          <button
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-ink px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-700"
            type="button"
            onClick={() => onNavigate(routes.profile)}
          >
            <UserRound aria-hidden="true" size={18} />
            Edit profile
          </button>
        </div>
      </header>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Profile completion"
          value={`${completion.percent}%`}
          icon={UserRound}
        />
        <StatCard
          label="Resume"
          value={resume ? "Uploaded" : "Missing"}
          icon={FileUp}
        />
        <StatCard
          label="Queued jobs"
          value={String(queuedJobs)}
          icon={BriefcaseBusiness}
        />
        <StatCard
          label="Applications tracked"
          value={String(applications.length)}
          icon={ClipboardList}
        />
      </section>

      <section className="rounded-lg border border-line bg-white p-5 shadow-soft">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-4">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-emerald-50 text-emerald-700">
              <RecommendedIcon aria-hidden="true" size={22} />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Recommended next step
              </p>
              <h3 className="mt-1 text-lg font-semibold text-slate-950">
                {recommendedStep.title}
              </h3>
              <p className="mt-1 text-sm leading-6 text-slate-600">
                {recommendedStep.message}
              </p>
            </div>
          </div>
          <button
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-ink px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-400"
            type="button"
            disabled={recommendedStep.action === "score" && isScoring}
            onClick={() => {
              if (recommendedStep.action === "score") {
                onScoreJobs();
              } else if (recommendedStep.route) {
                onNavigate(recommendedStep.route);
              }
            }}
          >
            {recommendedStep.actionLabel}
            <ArrowRight aria-hidden="true" size={17} />
          </button>
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[1fr_1fr]">
        <div className="rounded-lg border border-line bg-white p-5 shadow-soft">
          <CompletionMeter completion={completion} />
          <button
            className="mt-5 inline-flex min-h-10 items-center gap-2 rounded-md border border-slate-300 px-3 text-sm font-semibold text-slate-800 transition hover:bg-slate-50"
            type="button"
            onClick={() => onNavigate(routes.profile)}
          >
            Continue profile
            <ArrowRight aria-hidden="true" size={17} />
          </button>
        </div>
        <ResumeStatusCard resume={resume} />
      </section>

      <section className="grid gap-5 xl:grid-cols-[1.4fr_0.8fr]">
        <div className="rounded-lg border border-line bg-white p-5 shadow-soft">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h3 className="text-base font-semibold text-slate-950">
                Queue overview
              </h3>
              <p className="mt-1 text-sm text-slate-500">
                Ingested jobs wait for matching before they move into review queues.
              </p>
            </div>
            <button
              className="inline-flex min-h-10 items-center gap-2 rounded-md border border-slate-300 px-3 text-sm font-semibold text-slate-800 transition hover:bg-slate-50"
              type="button"
              onClick={() => onNavigate(routes.ingestion)}
            >
              <ListChecks aria-hidden="true" size={17} />
              Open ingestion
            </button>
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            {["Apply Review", "Maybe", "Browse"].map((label) => (
              <div key={label} className="rounded-lg border border-slate-200 bg-panel p-4">
                <p className="text-sm font-medium text-slate-500">{label}</p>
                <p className="mt-2 text-2xl font-semibold text-slate-950">
                  {label === "Apply Review"
                    ? applyCount
                    : label === "Maybe"
                      ? maybeCount
                      : Math.max(browseCount, queuedJobs)}
                </p>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-line bg-white p-5 shadow-soft">
          <h3 className="text-base font-semibold text-slate-950">Recent activity</h3>
          <div className="mt-4 space-y-3">
            {auditLogs.length === 0 ? (
              <p className="text-sm text-slate-500">No activity recorded yet.</p>
            ) : (
              auditLogs.slice(0, 4).map((log) => (
                <div key={log.id} className="rounded-md border border-slate-200 p-3">
                  <p className="text-sm font-medium text-slate-800">
                    {activityLabel(log.action)}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {new Date(log.createdAt).toLocaleString()}
                  </p>
                </div>
              ))
            )}
          </div>
        </div>
      </section>

      {onClearWorkspace && (
        <section className="rounded-lg border border-dashed border-slate-300 bg-white p-5 shadow-soft">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-base font-semibold text-slate-950">
                Local development workspace
              </h3>
              <p className="mt-1 text-sm leading-6 text-slate-500">
                Clear locally stored demo data and return this browser to a fresh
                workspace.
              </p>
            </div>
            <button
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 text-sm font-semibold text-red-700 transition hover:bg-red-100"
              type="button"
              onClick={onClearWorkspace}
            >
              <RotateCcw aria-hidden="true" size={17} />
              Clear local workspace
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
