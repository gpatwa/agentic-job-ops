import { useState } from "react";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  ListChecks,
  Play,
  RefreshCw,
  Settings as SettingsIcon,
  ShieldAlert,
  Sparkles
} from "lucide-react";
import type {
  CareerOpsRun,
  CareerOpsSettings,
  CareerOpsScheduleMode,
  CompanyIntelligence,
  JobMatch,
  JobRiskSignal,
  NormalizedJob
} from "../models/domain";
import { summarizeCareerOps } from "../services/careerOpsService";

interface CareerOpsPageProps {
  settings: CareerOpsSettings;
  runs: CareerOpsRun[];
  isRunning: boolean;
  jobs: NormalizedJob[];
  matches: JobMatch[];
  intelligence: CompanyIntelligence[];
  riskSignals: JobRiskSignal[];
  onRunNow: () => void;
  onSaveSettings: (next: {
    scheduleMode: CareerOpsScheduleMode;
    preparePackagesForHighScoreJobs: boolean;
    highScoreThreshold: number;
    overrideHighRiskPackagePrep: boolean;
  }) => void;
}

function statusLabel(value: string): string {
  return value.replace(/_/g, " ");
}

function StatusPill({
  tone,
  children
}: {
  tone: "good" | "warn" | "bad" | "neutral";
  children: React.ReactNode;
}) {
  const palette =
    tone === "good"
      ? "bg-emerald-50 text-emerald-700"
      : tone === "warn"
        ? "bg-amber-50 text-amber-700"
        : tone === "bad"
          ? "bg-red-50 text-red-700"
          : "bg-slate-100 text-slate-700";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold capitalize ${palette}`}
    >
      {children}
    </span>
  );
}

function statusTone(status: string): "good" | "warn" | "bad" | "neutral" {
  if (status === "completed") return "good";
  if (status === "running" || status === "queued") return "neutral";
  if (status === "failed") return "bad";
  if (status === "cancelled") return "warn";
  return "neutral";
}

export function CareerOpsPage({
  settings,
  runs,
  isRunning,
  jobs,
  matches,
  intelligence,
  riskSignals,
  onRunNow,
  onSaveSettings
}: CareerOpsPageProps) {
  const summary = summarizeCareerOps(runs, settings);
  const [draft, setDraft] = useState({
    scheduleMode: settings.scheduleMode,
    preparePackagesForHighScoreJobs: settings.preparePackagesForHighScoreJobs,
    highScoreThreshold: settings.highScoreThreshold,
    overrideHighRiskPackagePrep: settings.overrideHighRiskPackagePrep
  });

  function handleSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    onSaveSettings({
      scheduleMode: draft.scheduleMode,
      preparePackagesForHighScoreJobs: draft.preparePackagesForHighScoreJobs,
      highScoreThreshold: draft.highScoreThreshold,
      overrideHighRiskPackagePrep: draft.overrideHighRiskPackagePrep
    });
  }

  const topHighMatches = matches
    .filter((match) => match.queue === "apply_review")
    .sort((a, b) => b.overallScore - a.overallScore)
    .slice(0, 3);
  const intelligenceByJobId = new Map(intelligence.map((i) => [i.jobId, i]));
  const riskSignalsByJobId = new Map<string, JobRiskSignal[]>();
  riskSignals.forEach((signal) => {
    const list = riskSignalsByJobId.get(signal.jobId) ?? [];
    list.push(signal);
    riskSignalsByJobId.set(signal.jobId, list);
  });

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-3xl">
          <p className="text-sm font-semibold uppercase tracking-wide text-emerald-700">
            Career Ops
          </p>
          <h2 className="mt-2 text-3xl font-semibold text-slate-950">
            Scheduled Career Ops runs
          </h2>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            One run ingests jobs, scores them, routes them to queues, and
            optionally prepares review-ready packages for the strongest fits.
            Submitting an application always remains a human decision.
          </p>
        </div>
        <button
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-ink px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-400"
          type="button"
          disabled={isRunning}
          onClick={onRunNow}
        >
          {isRunning ? (
            <RefreshCw className="animate-spin" aria-hidden="true" size={18} />
          ) : (
            <Play aria-hidden="true" size={18} />
          )}
          {isRunning ? "Running…" : "Run Career Ops now"}
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
            Career Ops never submits applications, never opens a browser
            assistant, and never bypasses CAPTCHA. Package preparation only
            runs for high-score jobs and never for companies on your avoid
            list.
          </p>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SummaryCard
          icon={CheckCircle2}
          label="Latest run"
          value={summary.latestRun ? statusLabel(summary.latestRun.status) : "—"}
          tone={summary.latestRun ? statusTone(summary.latestRun.status) : "neutral"}
        />
        <SummaryCard
          icon={Sparkles}
          label="Jobs scored"
          value={String(summary.latestRun?.jobsScored ?? 0)}
          tone="neutral"
        />
        <SummaryCard
          icon={ListChecks}
          label="Apply-queue matches"
          value={String(summary.latestRun?.applyReviewCount ?? 0)}
          tone={summary.latestRun?.applyReviewCount ? "good" : "neutral"}
        />
        <SummaryCard
          icon={CalendarClock}
          label="Next scheduled"
          value={
            summary.nextScheduledRunAt
              ? new Date(summary.nextScheduledRunAt).toLocaleString()
              : "Manual only"
          }
          tone="neutral"
        />
      </section>

      {summary.latestRun && (
        <section className="rounded-lg border border-line bg-white p-5 shadow-soft">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold text-slate-950">
                Latest digest
              </h3>
              <p className="mt-1 text-sm leading-6 text-slate-600">
                {summary.latestRun.digestSummary.recommendedNextAction}
              </p>
            </div>
            <StatusPill tone={statusTone(summary.latestRun.status)}>
              {statusLabel(summary.latestRun.status)}
            </StatusPill>
          </div>
          <ul className="mt-4 grid gap-2 text-sm leading-6 text-slate-700 md:grid-cols-2">
            {summary.latestRun.digestSummary.lines.map((line) => (
              <li
                key={line}
                className="rounded-md border border-slate-200 bg-panel px-3 py-2"
              >
                {line}
              </li>
            ))}
          </ul>
          {summary.latestRun.digestSummary.warnings.length > 0 && (
            <div className="mt-4 space-y-2">
              {summary.latestRun.digestSummary.warnings.map((warning) => (
                <div
                  key={warning}
                  className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"
                >
                  <AlertTriangle
                    aria-hidden="true"
                    className="mt-0.5 shrink-0 text-amber-800"
                    size={15}
                  />
                  {warning}
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      <form
        className="rounded-lg border border-line bg-white p-5 shadow-soft"
        onSubmit={handleSave}
      >
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-slate-100 text-slate-700">
            <SettingsIcon aria-hidden="true" size={18} />
          </div>
          <h3 className="text-base font-semibold text-slate-950">
            Schedule and preparation settings
          </h3>
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div>
            <label
              className="text-sm font-semibold text-slate-900"
              htmlFor="schedule-mode"
            >
              Schedule
            </label>
            <select
              id="schedule-mode"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              value={draft.scheduleMode}
              onChange={(e) =>
                setDraft((prev) => ({
                  ...prev,
                  scheduleMode: e.target.value as CareerOpsScheduleMode
                }))
              }
            >
              <option value="disabled">Disabled</option>
              <option value="manual_only">Manual only</option>
              <option value="daily">Daily</option>
              <option value="every_6_hours">Every 6 hours</option>
            </select>
            <p className="mt-1 text-xs text-slate-500">
              Schedules drive a "next run due" indicator in the dashboard.
              Career Ops still requires you to launch a run.
            </p>
          </div>

          <div>
            <label
              className="text-sm font-semibold text-slate-900"
              htmlFor="high-score-threshold"
            >
              High-score threshold
            </label>
            <input
              id="high-score-threshold"
              type="number"
              min={0}
              max={10}
              step={0.1}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              value={draft.highScoreThreshold}
              onChange={(e) =>
                setDraft((prev) => ({
                  ...prev,
                  highScoreThreshold: Number.parseFloat(e.target.value) || 0
                }))
              }
            />
            <p className="mt-1 text-xs text-slate-500">
              Default 8.0. Packages are only prepared for jobs scoring at or
              above this threshold.
            </p>
          </div>

          <div className="md:col-span-2">
            <label className="flex items-start gap-3 text-sm text-slate-800">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 rounded border-slate-300"
                checked={draft.preparePackagesForHighScoreJobs}
                onChange={(e) =>
                  setDraft((prev) => ({
                    ...prev,
                    preparePackagesForHighScoreJobs: e.target.checked
                  }))
                }
              />
              <span>
                <span className="font-semibold text-slate-900">
                  Prepare application packages for high-score jobs
                </span>
                <span className="mt-0.5 block text-xs text-slate-500">
                  Generates a review-ready package only. The user still
                  approves edits and submission.
                </span>
              </span>
            </label>
          </div>
          <div className="md:col-span-2">
            <label className="flex items-start gap-3 text-sm text-slate-800">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 rounded border-slate-300"
                checked={draft.overrideHighRiskPackagePrep}
                onChange={(e) =>
                  setDraft((prev) => ({
                    ...prev,
                    overrideHighRiskPackagePrep: e.target.checked
                  }))
                }
              />
              <span>
                <span className="font-semibold text-slate-900">
                  Override the high-risk package skip
                </span>
                <span className="mt-0.5 block text-xs text-slate-500">
                  Off by default. When off, jobs flagged with a high-severity
                  risk signal (suspicious domain, fee request, free-email
                  contact, etc.) are skipped from automatic package prep.
                </span>
              </span>
            </label>
          </div>
        </div>

        <div className="mt-4 flex justify-end">
          <button
            type="submit"
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-ink px-3 text-sm font-semibold text-white transition hover:bg-slate-700"
          >
            Save settings
          </button>
        </div>
      </form>

      {topHighMatches.length > 0 && (
        <section className="rounded-lg border border-line bg-white p-5 shadow-soft">
          <h3 className="text-base font-semibold text-slate-950">
            Top high-match jobs
          </h3>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            Estimated context for the strongest matches in this run. Always
            verify before relying on it.
          </p>
          <ul className="mt-3 space-y-3">
            {topHighMatches.map((match) => {
              const job = jobs.find((item) => item.id === match.jobId);
              if (!job) return null;
              const intel = intelligenceByJobId.get(job.id);
              const signals = riskSignalsByJobId.get(job.id) ?? [];
              const highRisk = signals.some((signal) => signal.severity === "high");
              return (
                <li
                  key={match.id}
                  className={`rounded-md border ${
                    highRisk ? "border-red-200 bg-red-50" : "border-slate-200 bg-panel"
                  } p-3`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">
                        {job.title} — {job.company}
                      </p>
                      <p className="mt-1 text-xs text-slate-600">
                        Match {match.overallScore.toFixed(1)} / 10 · Queue{" "}
                        {match.queue.replace(/_/g, " ")}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2 text-xs">
                      {intel ? (
                        <span className="rounded-md bg-emerald-50 px-2 py-1 font-semibold capitalize text-emerald-700">
                          Intel · {intel.confidence}
                        </span>
                      ) : (
                        <span className="rounded-md bg-slate-100 px-2 py-1 font-semibold text-slate-600">
                          No intelligence yet
                        </span>
                      )}
                      {signals.length > 0 ? (
                        <span
                          className={`rounded-md px-2 py-1 font-semibold capitalize ${
                            highRisk
                              ? "bg-red-100 text-red-700"
                              : "bg-amber-100 text-amber-800"
                          }`}
                        >
                          {signals.length} risk signal
                          {signals.length === 1 ? "" : "s"}
                        </span>
                      ) : (
                        <span className="rounded-md bg-emerald-50 px-2 py-1 font-semibold text-emerald-700">
                          No risk signals
                        </span>
                      )}
                    </div>
                  </div>
                  {intel && (
                    <p className="mt-2 text-sm leading-6 text-slate-700">
                      {intel.summary}
                    </p>
                  )}
                  {highRisk && (
                    <p className="mt-2 text-xs leading-5 text-red-700">
                      High-severity risk detected. Package preparation skips
                      this job by default; you can override in settings.
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section className="rounded-lg border border-line bg-white p-5 shadow-soft">
        <h3 className="text-base font-semibold text-slate-950">
          Run history
        </h3>
        {runs.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">
            No Career Ops runs yet. Click <strong>Run Career Ops now</strong>{" "}
            above to start one.
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto rounded-md border border-slate-200">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Started
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Mode
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Status
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Found
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Scored
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Apply / Maybe / Browse
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Packages
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Error
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {runs.map((run) => (
                  <tr key={run.id}>
                    <td className="px-3 py-2 text-xs text-slate-600">
                      {new Date(run.startedAt).toLocaleString()}
                    </td>
                    <td className="px-3 py-2 capitalize text-slate-700">
                      {statusLabel(run.mode)}
                    </td>
                    <td className="px-3 py-2">
                      <StatusPill tone={statusTone(run.status)}>
                        {statusLabel(run.status)}
                      </StatusPill>
                    </td>
                    <td className="px-3 py-2 text-slate-700">{run.jobsFound}</td>
                    <td className="px-3 py-2 text-slate-700">{run.jobsScored}</td>
                    <td className="px-3 py-2 text-slate-700">
                      {run.applyReviewCount} / {run.maybeCount} / {run.browseCount}
                    </td>
                    <td className="px-3 py-2 text-slate-700">{run.packagesPrepared}</td>
                    <td className="px-3 py-2 text-xs text-red-700">
                      {run.errorMessage || ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  tone
}: {
  icon: typeof CheckCircle2;
  label: string;
  value: string;
  tone: "good" | "warn" | "bad" | "neutral";
}) {
  const accent =
    tone === "good"
      ? "text-emerald-700"
      : tone === "warn"
        ? "text-amber-700"
        : tone === "bad"
          ? "text-red-700"
          : "text-slate-700";
  return (
    <div className="rounded-lg border border-line bg-white p-4 shadow-soft">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-slate-500">{label}</p>
          <p className={`mt-2 text-2xl font-semibold ${accent}`}>{value}</p>
        </div>
        <div className="flex h-10 w-10 items-center justify-center rounded-md bg-slate-100 text-slate-700">
          <Icon aria-hidden="true" size={21} />
        </div>
      </div>
    </div>
  );
}

