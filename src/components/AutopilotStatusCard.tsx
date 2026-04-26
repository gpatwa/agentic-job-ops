import {
  ArrowRight,
  CheckCircle2,
  Inbox,
  Play,
  RefreshCw,
  Rocket,
  ShieldCheck,
  Sparkles
} from "lucide-react";
import type { AutopilotSummary } from "../services/autopilotService";

interface AutopilotStatusCardProps {
  summary: AutopilotSummary;
  isAutopilotRunning: boolean;
  onRunAutopilotNow: () => void;
  onOpenActionCenter: () => void;
  onOpenSettings: () => void;
  onToggleEnabled: () => void;
}

function formatNextRun(value: string | null): string {
  if (!value) return "Manual only";
  return new Date(value).toLocaleString();
}

function statusLabel(value: string): string {
  return value.replace(/_/g, " ");
}

export function AutopilotStatusCard({
  summary,
  isAutopilotRunning,
  onRunAutopilotNow,
  onOpenActionCenter,
  onOpenSettings,
  onToggleEnabled
}: AutopilotStatusCardProps) {
  return (
    <section className="rounded-lg border border-emerald-200 bg-white p-5 shadow-soft">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-emerald-50 text-emerald-700">
            <Rocket aria-hidden="true" size={22} />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-base font-semibold text-slate-950">
                Autopilot
              </h3>
              <span
                className={`rounded-md px-2 py-0.5 text-xs font-semibold uppercase tracking-wide ${
                  summary.enabled
                    ? "bg-emerald-100 text-emerald-800"
                    : "bg-slate-100 text-slate-700"
                }`}
              >
                {summary.enabled ? "On" : "Off"}
              </span>
            </div>
            <p className="mt-1 text-sm leading-6 text-slate-600">
              Less setup, less forms. Autopilot scores jobs and (optionally)
              prepares packages — submit always remains your call.
            </p>
            <p className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-900">
              <ShieldCheck aria-hidden="true" size={12} />
              Final submit always requires your explicit approval.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-ink px-3 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-400"
            disabled={isAutopilotRunning}
            onClick={onRunAutopilotNow}
          >
            {isAutopilotRunning ? (
              <RefreshCw className="animate-spin" aria-hidden="true" size={16} />
            ) : (
              <Play aria-hidden="true" size={16} />
            )}
            {isAutopilotRunning ? "Running…" : "Run Autopilot now"}
          </button>
          <button
            type="button"
            className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-md px-3 text-sm font-semibold transition ${
              summary.enabled
                ? "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                : "bg-emerald-700 text-white hover:bg-emerald-800"
            }`}
            onClick={onToggleEnabled}
          >
            {summary.enabled ? "Turn off" : "Turn on"}
          </button>
          <button
            type="button"
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            onClick={onOpenSettings}
          >
            Settings
          </button>
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-md border border-slate-200 bg-panel px-3 py-2">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Next run
          </p>
          <p className="mt-1 text-sm font-semibold text-slate-900">
            {formatNextRun(summary.nextRunAt)}
          </p>
        </div>
        <div className="rounded-md border border-slate-200 bg-panel px-3 py-2">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Latest run
          </p>
          <p className="mt-1 text-sm font-semibold capitalize text-slate-900">
            {summary.latestRun
              ? statusLabel(summary.latestRun.status)
              : "no runs yet"}
          </p>
          {summary.latestRun && (
            <p className="mt-0.5 text-xs text-slate-500">
              {summary.latestRun.highScoreJobs} high-match ·{" "}
              {summary.latestRun.packagesPrepared} packages
            </p>
          )}
        </div>
        <div className="rounded-md border border-slate-200 bg-panel px-3 py-2">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Pending decisions
          </p>
          <p className="mt-1 text-sm font-semibold text-slate-900">
            {summary.pendingActionsCount}
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            {summary.submitApprovalsPendingCount > 0
              ? `${summary.submitApprovalsPendingCount} submit approval${
                  summary.submitApprovalsPendingCount === 1 ? "" : "s"
                } waiting`
              : "Submit approvals will appear here"}
          </p>
        </div>
        <div className="rounded-md border border-slate-200 bg-panel px-3 py-2">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Open actions
          </p>
          <ul className="mt-1 space-y-0.5 text-xs text-slate-600">
            <li className="flex items-center gap-1">
              <Sparkles aria-hidden="true" size={11} />
              {summary.highMatchActionsCount} high-match jobs
            </li>
            <li className="flex items-center gap-1">
              <Inbox aria-hidden="true" size={11} />
              {summary.packagesAwaitingReviewCount} packages to review
            </li>
            <li className="flex items-center gap-1">
              <CheckCircle2 aria-hidden="true" size={11} />
              {summary.submitApprovalsPendingCount} ready to approve
            </li>
          </ul>
        </div>
      </div>

      {summary.pendingActionsCount > 0 && (
        <div className="mt-4 flex flex-col gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-amber-900">
            {summary.pendingActionsCount} decision
            {summary.pendingActionsCount === 1 ? "" : "s"} waiting in the
            Action Center.
          </p>
          <button
            type="button"
            className="inline-flex min-h-9 items-center gap-2 rounded-md border border-amber-300 bg-white px-3 text-xs font-semibold text-amber-900 transition hover:bg-amber-100"
            onClick={onOpenActionCenter}
          >
            Open Action Center
            <ArrowRight aria-hidden="true" size={13} />
          </button>
        </div>
      )}
    </section>
  );
}
