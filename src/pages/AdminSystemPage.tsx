import {
  Activity,
  BarChart3,
  CheckCircle2,
  ClipboardList,
  Gauge,
  RefreshCw,
  ShieldAlert,
  XCircle
} from "lucide-react";
import type {
  AIOutputMetadata,
  ApplicationOutcome,
  ApplicationPackage,
  ApplicationRecord,
  AuditLog,
  BrowserApplicationSession,
  EvalResult,
  EvalRun,
  ExtensionSession,
  FeedbackEvent,
  JobMatch,
  NormalizedJob,
  UsageMeteringEvent
} from "../models/domain";
import { summarizeAIOutputMetadata } from "../services/aiOutputMetadata";
import { summarizeApplicationOutcomes } from "../services/applicationOutcomeService";
import { summarizeLatestEvalRun } from "../services/evalService";
import { summarizeFeedbackEvents } from "../services/feedbackService";
import {
  summarizeUsageByEvent,
  summarizeUsageByTenant
} from "../services/usageMetering";

interface AdminSystemPageProps {
  jobs: NormalizedJob[];
  matches: JobMatch[];
  packages: ApplicationPackage[];
  browserSessions: BrowserApplicationSession[];
  extensionSessions: ExtensionSession[];
  applications: ApplicationRecord[];
  auditLogs: AuditLog[];
  feedbackEvents: FeedbackEvent[];
  usageEvents: UsageMeteringEvent[];
  evalRuns: EvalRun[];
  evalResults: EvalResult[];
  outcomes: ApplicationOutcome[];
  aiOutputMetadata: AIOutputMetadata[];
  isRunningEvals: boolean;
  onRunEvals: () => void;
}

function statusLabel(value: string): string {
  return value.replace(/_/g, " ");
}

function StatCard({
  label,
  value,
  icon: Icon
}: {
  label: string;
  value: string;
  icon: typeof BarChart3;
}) {
  return (
    <div className="rounded-lg border border-line bg-white p-4 shadow-soft">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-slate-500">{label}</p>
          <p className="mt-2 text-2xl font-semibold text-slate-950">{value}</p>
        </div>
        <div className="flex h-10 w-10 items-center justify-center rounded-md bg-emerald-50 text-emerald-700">
          <Icon aria-hidden="true" size={21} />
        </div>
      </div>
    </div>
  );
}

function CountList({ counts }: { counts: Record<string, number> }) {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) {
    return <p className="text-sm text-slate-500">No events recorded yet.</p>;
  }

  return (
    <div className="space-y-2">
      {entries.slice(0, 8).map(([label, value]) => (
        <div
          key={label}
          className="flex items-center justify-between gap-3 rounded-md border border-slate-200 bg-panel px-3 py-2"
        >
          <span className="text-sm capitalize text-slate-700">
            {statusLabel(label)}
          </span>
          <span className="text-sm font-semibold text-slate-950">{value}</span>
        </div>
      ))}
    </div>
  );
}

export function AdminSystemPage({
  jobs,
  matches,
  packages,
  browserSessions,
  extensionSessions,
  applications,
  auditLogs,
  feedbackEvents,
  usageEvents,
  evalRuns,
  evalResults,
  outcomes,
  aiOutputMetadata,
  isRunningEvals,
  onRunEvals
}: AdminSystemPageProps) {
  const feedbackCounts = summarizeFeedbackEvents(feedbackEvents);
  const usageByEvent = summarizeUsageByEvent(usageEvents);
  const usageByTenant = summarizeUsageByTenant(usageEvents);
  const outcomeCounts = summarizeApplicationOutcomes(outcomes);
  const aiMetadataCounts = summarizeAIOutputMetadata(aiOutputMetadata);
  const latestEval = summarizeLatestEvalRun(evalRuns, evalResults);
  const latestEvalRunId = latestEval.latestRun?.id;
  const latestEvalResults = latestEvalRunId
    ? evalResults.filter((result) => result.evalRunId === latestEvalRunId)
    : [];
  const latestEvalSuites =
    latestEval.latestRun && latestEvalResults.length > 0
      ? Array.from(new Set(latestEvalResults.map((result) => result.suite)))
      : latestEval.latestRun
        ? [latestEval.latestRun.suite]
        : [];
  const latestEvalTimestamp = latestEval.latestRun
    ? new Date(
        latestEval.latestRun.finishedAt ?? latestEval.latestRun.startedAt
      ).toLocaleString()
    : "";
  const submittedCount = applications.filter(
    (application) => application.status === "submitted"
  ).length;
  const recentFailures = [
    ...auditLogs.filter((log) => log.action.includes("failed")).slice(0, 3),
    ...browserSessions
      .filter((session) => ["failed", "manual_required"].includes(session.status))
      .slice(0, 3)
      .map((session) => ({
        id: session.id,
        action: `browser_${session.status}`,
        createdAt: session.updatedAt
      })),
    ...latestEval.failedResults.slice(0, 3).map((result) => ({
      id: result.id,
      action: `eval_failed: ${result.name}`,
      createdAt: result.createdAt
    }))
  ].slice(0, 6);

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-3xl">
          <p className="text-sm font-semibold uppercase tracking-wide text-emerald-700">
            Admin
          </p>
          <h2 className="mt-2 text-3xl font-semibold text-slate-950">
            System visibility
          </h2>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            Monitor quality, safety, usage, outcomes, and audit signals without
            optimizing for raw application volume.
          </p>
        </div>
        <button
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-ink px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-400"
          type="button"
          disabled={isRunningEvals}
          onClick={onRunEvals}
        >
          {isRunningEvals ? (
            <RefreshCw className="animate-spin" aria-hidden="true" size={18} />
          ) : (
            <Gauge aria-hidden="true" size={18} />
          )}
          {isRunningEvals ? "Running evals" : "Run deterministic evals"}
        </button>
      </header>

      <section className="rounded-lg border border-amber-200 bg-amber-50 p-4">
        <div className="flex gap-3">
          <ShieldAlert
            aria-hidden="true"
            className="mt-0.5 shrink-0 text-amber-800"
            size={18}
          />
          <p className="text-sm leading-6 text-amber-900">
            Optimization targets are strong-fit applications, approval rate,
            recruiter response, interview conversion, truthful application quality,
            and low unsupported-claim rate. Raw submissions are not a success metric.
          </p>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
        <StatCard label="Jobs ingested" value={String(jobs.length)} icon={BarChart3} />
        <StatCard label="Jobs scored" value={String(matches.length)} icon={Gauge} />
        <StatCard
          label="Packages generated"
          value={String(packages.length)}
          icon={ClipboardList}
        />
        <StatCard
          label="Browser sessions"
          value={String(browserSessions.length)}
          icon={Activity}
        />
        <StatCard
          label="Extension sessions"
          value={String(extensionSessions.length)}
          icon={Activity}
        />
        <StatCard
          label="Applications submitted"
          value={String(submittedCount)}
          icon={CheckCircle2}
        />
      </section>

      <section className="grid gap-5 xl:grid-cols-3">
        <div className="rounded-lg border border-line bg-white p-5 shadow-soft">
          <h3 className="text-base font-semibold text-slate-950">
            Eval pass/fail
          </h3>
          {latestEval.latestRun ? (
            <div className="mt-4 space-y-4">
              <div className="rounded-md border border-slate-200 bg-panel p-3">
                <p className="text-sm font-semibold text-slate-900">
                  Latest run
                </p>
                <p className="mt-1 text-sm text-slate-600">
                  {latestEvalTimestamp}
                </p>
                <p className="mt-2 text-xs capitalize text-slate-500">
                  Suites: {latestEvalSuites.map(statusLabel).join(", ")}
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3">
                  <p className="text-sm text-emerald-700">Passed</p>
                  <p className="mt-1 text-2xl font-semibold text-emerald-950">
                    {latestEval.passCount}
                  </p>
                </div>
                <div className="rounded-md border border-red-200 bg-red-50 p-3">
                  <p className="text-sm text-red-700">Failed</p>
                  <p className="mt-1 text-2xl font-semibold text-red-950">
                    {latestEval.failCount}
                  </p>
                </div>
              </div>

              {latestEval.failedResults.length > 0 ? (
                <div className="rounded-md border border-red-100 bg-red-50 p-3">
                  <p className="text-sm font-semibold text-red-950">
                    Failed checks
                  </p>
                  <div className="mt-3 space-y-2">
                    {latestEval.failedResults.slice(0, 6).map((result) => (
                      <div key={result.id}>
                        <p className="text-sm font-medium text-red-950">
                          {result.name}
                        </p>
                        <p className="mt-1 text-xs leading-5 text-red-800">
                          {result.message}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-2 rounded-md border border-emerald-100 bg-emerald-50 p-3">
                  <CheckCircle2
                    aria-hidden="true"
                    className="mt-0.5 shrink-0 text-emerald-700"
                    size={16}
                  />
                  <p className="text-sm text-emerald-800">
                    No failed checks in the latest eval run.
                  </p>
                </div>
              )}
            </div>
          ) : (
            <p className="mt-3 text-sm text-slate-500">No eval run yet.</p>
          )}
        </div>

        <div className="rounded-lg border border-line bg-white p-5 shadow-soft">
          <h3 className="text-base font-semibold text-slate-950">
            Feedback events
          </h3>
          <div className="mt-4">
            <CountList counts={feedbackCounts} />
          </div>
        </div>

        <div className="rounded-lg border border-line bg-white p-5 shadow-soft">
          <h3 className="text-base font-semibold text-slate-950">
            Outcome tracking
          </h3>
          <div className="mt-4">
            <CountList counts={outcomeCounts} />
          </div>
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-3">
        <div className="rounded-lg border border-line bg-white p-5 shadow-soft">
          <h3 className="text-base font-semibold text-slate-950">
            Usage by event
          </h3>
          <div className="mt-4">
            <CountList counts={usageByEvent} />
          </div>
        </div>

        <div className="rounded-lg border border-line bg-white p-5 shadow-soft">
          <h3 className="text-base font-semibold text-slate-950">
            Usage by tenant
          </h3>
          <div className="mt-4">
            <CountList counts={usageByTenant} />
          </div>
        </div>

        <div className="rounded-lg border border-line bg-white p-5 shadow-soft">
          <h3 className="text-base font-semibold text-slate-950">
            AI output metadata
          </h3>
          <div className="mt-4">
            <CountList counts={aiMetadataCounts} />
          </div>
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[1fr_1fr]">
        <div className="rounded-lg border border-line bg-white p-5 shadow-soft">
          <h3 className="text-base font-semibold text-slate-950">
            Recent audit events
          </h3>
          <div className="mt-4 space-y-3">
            {auditLogs.slice(0, 6).map((log) => (
              <div key={log.id} className="rounded-md border border-slate-200 p-3">
                <p className="text-sm font-semibold text-slate-900">
                  {statusLabel(log.action)}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {new Date(log.createdAt).toLocaleString()}
                </p>
              </div>
            ))}
            {auditLogs.length === 0 && (
              <p className="text-sm text-slate-500">No audit events yet.</p>
            )}
          </div>
        </div>

        <div className="rounded-lg border border-line bg-white p-5 shadow-soft">
          <h3 className="text-base font-semibold text-slate-950">
            Recent failures and manual fallbacks
          </h3>
          <div className="mt-4 space-y-3">
            {recentFailures.map((failure) => (
              <div key={failure.id} className="rounded-md border border-red-100 bg-red-50 p-3">
                <div className="flex items-start gap-2">
                  <XCircle
                    aria-hidden="true"
                    className="mt-0.5 shrink-0 text-red-700"
                    size={16}
                  />
                  <div>
                    <p className="text-sm font-semibold text-red-950">
                      {statusLabel(failure.action)}
                    </p>
                    <p className="mt-1 text-xs text-red-700">
                      {new Date(failure.createdAt).toLocaleString()}
                    </p>
                  </div>
                </div>
              </div>
            ))}
            {recentFailures.length === 0 && (
              <p className="text-sm text-slate-500">No recent failures.</p>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
