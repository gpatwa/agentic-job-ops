import {
  Activity,
  BarChart3,
  CheckCircle2,
  ClipboardList,
  Cpu,
  Gauge,
  RefreshCw,
  ShieldAlert,
  XCircle
} from "lucide-react";
import { useEffect, useState } from "react";
import {
  fetchAiProbe,
  fetchAiStatus,
  type ApiAiProbe,
  type ApiAiStatus
} from "../services/resumeIntelligenceApiClient";
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
    <div className="space-y-6" data-testid="admin-system">
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

      <AiDiagnosticsSection
        aiOutputMetadata={aiOutputMetadata}
        auditLogs={auditLogs}
      />

      <section className="grid gap-5 xl:grid-cols-[1fr_1fr]">
        <div className="rounded-lg border border-line bg-white p-5 shadow-soft">
          <h3 className="text-base font-semibold text-slate-950">
            Recent audit events
          </h3>
          <div className="mt-4 space-y-3" data-testid="audit-events">
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

/**
 * AI Diagnostics — internal-only view of the active AI provider,
 * model/deployment, last LLM call, and reachability of the local
 * AI API server.
 *
 * Hard rule: this section must NEVER render the API key, raw
 * resume text, sensitive candidate details, or any user content.
 * It only shows aggregated metadata that the AI output metadata
 * service has already classified as safe to log
 * (provider/model/promptVersion/timestamp/mode).
 */
function AiDiagnosticsSection({
  aiOutputMetadata,
  auditLogs
}: {
  aiOutputMetadata: AIOutputMetadata[];
  auditLogs: AuditLog[];
}) {
  const [status, setStatus] = useState<ApiAiStatus | null>(null);
  const [statusLoaded, setStatusLoaded] = useState(false);
  const [probe, setProbe] = useState<ApiAiProbe | null>(null);
  const [probeLoaded, setProbeLoaded] = useState(false);
  const [isReprobing, setIsReprobing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchAiStatus().then((result) => {
      if (cancelled) return;
      setStatus(result);
      setStatusLoaded(true);
    });
    fetchAiProbe().then((result) => {
      if (cancelled) return;
      setProbe(result);
      setProbeLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleReprobe() {
    setIsReprobing(true);
    try {
      // force=1 bypasses the 60 s server-side cache so an operator
      // can confirm a config change took effect immediately.
      const result = await fetchAiProbe({ force: true });
      setProbe(result);
      setProbeLoaded(true);
    } finally {
      setIsReprobing(false);
    }
  }

  // Pick the most recent LLM-mode entry as a "last analysis" anchor.
  // Falls back to the most recent metadata entry of any mode.
  const sortedMetadata = [...aiOutputMetadata].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt)
  );
  const lastLlm = sortedMetadata.find((entry) => entry.mode !== "deterministic");
  const lastEntry = lastLlm ?? sortedMetadata[0] ?? null;

  // Surface the most recent AI-related failure / fallback signal
  // from audit so an operator can correlate with provider state.
  const lastFailure = auditLogs
    .filter(
      (log) =>
        log.action.includes("primary_failed") ||
        log.action.includes("fallback") ||
        log.action.includes("ai_") ||
        log.action.includes("llm")
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];

  const apiReachable = statusLoaded && status !== null;
  const providerLabel = status?.provider ?? "unknown";

  return (
    <section
      className="rounded-lg border border-slate-200 bg-white p-5 shadow-soft"
      data-testid="ai-diagnostics"
    >
      <div className="flex items-start gap-3">
        <Cpu aria-hidden="true" className="mt-0.5 text-slate-700" size={18} />
        <div className="flex-1">
          <h3 className="text-base font-semibold text-slate-950">
            AI diagnostics (internal)
          </h3>
          <p className="mt-1 text-sm text-slate-600">
            Provider, model, and last call metadata for the local AI API
            server. Customer-facing onboarding shows analysis quality only —
            this is the operator view. No raw resume text, no API keys, no
            candidate PII is included.
          </p>

          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-3">
            <DiagnosticRow
              label="AI service status"
              value={
                !statusLoaded
                  ? "checking…"
                  : apiReachable
                    ? "connected"
                    : "offline (frontend deterministic fallback)"
              }
              tone={
                !statusLoaded
                  ? "neutral"
                  : apiReachable
                    ? "ok"
                    : "warn"
              }
              testId="ai-diagnostics-service-status"
            />
            <DiagnosticRow
              label="Provider"
              value={providerLabel}
              tone="neutral"
              testId="ai-diagnostics-provider"
            />
            <DiagnosticRow
              label="Model / deployment"
              value={status?.resumeModel ?? "—"}
              tone="neutral"
              testId="ai-diagnostics-model"
            />
            <DiagnosticRow
              label="Provider configured"
              value={status ? (status.configured ? "yes" : "no") : "—"}
              tone={
                status ? (status.configured ? "ok" : "warn") : "neutral"
              }
              testId="ai-diagnostics-configured"
            />
            <DiagnosticRow
              label="Fallback available"
              value={status?.fallbackAvailable ? "yes" : status ? "no" : "—"}
              tone="ok"
              testId="ai-diagnostics-fallback"
            />
            <DiagnosticRow
              label="Last analysis mode"
              value={lastEntry ? lastEntry.mode : "—"}
              tone="neutral"
              testId="ai-diagnostics-last-mode"
            />
            <DiagnosticRow
              label="Last analysis at"
              value={
                lastEntry
                  ? new Date(lastEntry.createdAt).toLocaleString()
                  : "—"
              }
              tone="neutral"
              testId="ai-diagnostics-last-at"
            />
            <DiagnosticRow
              label="Last error category"
              value={lastFailure ? statusLabel(lastFailure.action) : "none"}
              tone={lastFailure ? "warn" : "ok"}
              testId="ai-diagnostics-last-error"
            />
          </dl>

          {/* LLM round-trip probe — actually calls the provider
              with a tiny request shaped like the real call so
              parameter-shape regressions trip immediately. The
              status above only inspects local env. */}
          <div
            className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-3"
            data-testid="ai-diagnostics-probe"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs uppercase tracking-wide text-slate-500">
                LLM round-trip probe
              </p>
              <button
                type="button"
                className="inline-flex min-h-7 items-center gap-1 rounded-md border border-slate-300 bg-white px-2 text-[11px] font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                onClick={handleReprobe}
                disabled={isReprobing}
                data-testid="ai-diagnostics-probe-retry"
              >
                <RefreshCw
                  aria-hidden="true"
                  size={11}
                  className={isReprobing ? "animate-spin" : ""}
                />
                {isReprobing ? "Probing…" : "Re-probe"}
              </button>
            </div>
            {!probeLoaded && (
              <p className="mt-2 text-xs text-slate-500">checking…</p>
            )}
            {probeLoaded && !probe && (
              <p className="mt-2 text-xs text-slate-500">
                API server unreachable — start it with{" "}
                <code className="rounded bg-slate-200 px-1">npm run dev:api</code>.
              </p>
            )}
            {probeLoaded && probe && (
              <p
                className={`mt-2 text-sm font-semibold ${
                  probe.ok ? "text-emerald-800" : "text-amber-900"
                }`}
                data-testid="ai-diagnostics-probe-summary"
              >
                {probe.ok ? "✓" : "✗"} {probe.provider} · {probe.model} ·{" "}
                {probe.ok
                  ? `${probe.latencyMs} ms`
                  : (probe.errorCategory ?? "unknown")}{" "}
                · {probe.cached ? "cached" : "fresh"} ·{" "}
                {new Date(probe.observedAt).toLocaleTimeString()}
              </p>
            )}
            {probeLoaded && probe && !probe.ok && probe.errorDetail && (
              <p
                className="mt-1 text-xs text-amber-900"
                data-testid="ai-diagnostics-probe-detail"
              >
                {probe.errorDetail}
              </p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function DiagnosticRow({
  label,
  value,
  tone,
  testId
}: {
  label: string;
  value: string;
  tone: "ok" | "warn" | "neutral";
  testId: string;
}) {
  const valueClass =
    tone === "ok"
      ? "text-emerald-800"
      : tone === "warn"
        ? "text-amber-900"
        : "text-slate-800";
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 p-3" data-testid={testId}>
      <dt className="text-xs uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className={`mt-1 text-sm font-semibold ${valueClass}`}>{value}</dd>
    </div>
  );
}
