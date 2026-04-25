import {
  AlertCircle,
  CheckCircle2,
  Clock,
  DatabaseZap,
  Link,
  Play,
  Plus,
  RefreshCw
} from "lucide-react";
import { FormEvent, useMemo, useState } from "react";
import type {
  JobSource,
  JobSourceConfig,
  NormalizedJob,
  ScanRun,
  ScanSchedule
} from "../models/domain";
import type { JobSourceConfigDraft } from "../services/jobIngestion";
import { getDueSourceConfigs } from "../services/jobIngestion";

interface IngestionAdminPageProps {
  configs: JobSourceConfig[];
  scanRuns: ScanRun[];
  jobs: NormalizedJob[];
  isScanning: boolean;
  onSaveConfig: (draft: JobSourceConfigDraft) => void;
  onRunScan: (configId: string) => void;
  onManualImport: (url: string) => void;
}

const emptyDraft: JobSourceConfigDraft = {
  source: "greenhouse",
  displayName: "",
  companyName: "",
  boardToken: "",
  siteName: "",
  manualUrl: "",
  schedule: "manual",
  enabled: true
};

function scheduleLabel(schedule: ScanSchedule): string {
  if (schedule === "every_6_hours") {
    return "Every 6 hours";
  }

  return schedule === "daily" ? "Daily" : "Manual";
}

function statusTone(status: ScanRun["status"]): string {
  if (status === "succeeded") {
    return "bg-emerald-50 text-emerald-700";
  }

  if (status === "failed") {
    return "bg-red-50 text-red-700";
  }

  return "bg-sky-50 text-sky-700";
}

function sourceHint(source: JobSource): string {
  if (source === "greenhouse") {
    return "Use the Greenhouse board token, such as the value after boards.greenhouse.io/.";
  }

  if (source === "lever") {
    return "Use the Lever site name, such as the value after jobs.lever.co/.";
  }

  return "Manual imports currently store the URL as a queued placeholder.";
}

export function IngestionAdminPage({
  configs,
  scanRuns,
  jobs,
  isScanning,
  onSaveConfig,
  onRunScan,
  onManualImport
}: IngestionAdminPageProps) {
  const [draft, setDraft] = useState<JobSourceConfigDraft>(emptyDraft);
  const [manualUrl, setManualUrl] = useState("");
  const dueConfigs = useMemo(() => getDueSourceConfigs(configs), [configs]);

  function update<K extends keyof JobSourceConfigDraft>(
    key: K,
    value: JobSourceConfigDraft[K]
  ) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function handleConfigSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSaveConfig(draft);
    setDraft(emptyDraft);
  }

  function handleManualSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!manualUrl.trim()) {
      return;
    }

    onManualImport(manualUrl);
    setManualUrl("");
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-emerald-700">
            Ingestion
          </p>
          <h2 className="mt-2 text-3xl font-semibold text-slate-950">
            Job ingestion admin
          </h2>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
            Configure public ATS boards, run manual scans, and keep new jobs queued
            for Phase 3 scoring.
          </p>
        </div>
        <div className="rounded-lg border border-line bg-white px-4 py-3 shadow-soft">
          <p className="text-sm font-medium text-slate-500">Due scheduled scans</p>
          <p className="mt-1 text-2xl font-semibold text-slate-950">
            {dueConfigs.length}
          </p>
        </div>
      </header>

      <section className="grid gap-5 xl:grid-cols-[1fr_0.8fr]">
        <form
          className="rounded-lg border border-line bg-white p-5 shadow-soft"
          onSubmit={handleConfigSubmit}
        >
          <div className="flex items-start gap-4">
            <div className="flex h-11 w-11 items-center justify-center rounded-md bg-sky-50 text-sky-700">
              <DatabaseZap aria-hidden="true" size={22} />
            </div>
            <div>
              <h3 className="text-base font-semibold text-slate-950">
                Add source configuration
              </h3>
              <p className="mt-1 text-sm text-slate-500">{sourceHint(draft.source)}</p>
            </div>
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <label className="space-y-2">
              <span className="text-sm font-medium text-slate-700">Source</span>
              <select
                className="min-h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 shadow-sm"
                value={draft.source}
                onChange={(event) => update("source", event.target.value as JobSource)}
              >
                <option value="greenhouse">Greenhouse</option>
                <option value="lever">Lever</option>
              </select>
            </label>
            <label className="space-y-2">
              <span className="text-sm font-medium text-slate-700">Schedule</span>
              <select
                className="min-h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 shadow-sm"
                value={draft.schedule}
                onChange={(event) =>
                  update("schedule", event.target.value as ScanSchedule)
                }
              >
                <option value="manual">Manual</option>
                <option value="daily">Daily</option>
                <option value="every_6_hours">Every 6 hours</option>
              </select>
            </label>
            <label className="space-y-2">
              <span className="text-sm font-medium text-slate-700">Display name</span>
              <input
                className="min-h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 shadow-sm"
                required
                value={draft.displayName}
                onChange={(event) => update("displayName", event.target.value)}
                placeholder="Acme careers"
              />
            </label>
            <label className="space-y-2">
              <span className="text-sm font-medium text-slate-700">Company</span>
              <input
                className="min-h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 shadow-sm"
                value={draft.companyName}
                onChange={(event) => update("companyName", event.target.value)}
                placeholder="Acme"
              />
            </label>
            <label className="space-y-2">
              <span className="text-sm font-medium text-slate-700">
                Greenhouse board token
              </span>
              <input
                className="min-h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 shadow-sm disabled:bg-slate-100"
                disabled={draft.source !== "greenhouse"}
                value={draft.boardToken}
                onChange={(event) => update("boardToken", event.target.value)}
                placeholder="company"
              />
            </label>
            <label className="space-y-2">
              <span className="text-sm font-medium text-slate-700">
                Lever site name
              </span>
              <input
                className="min-h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 shadow-sm disabled:bg-slate-100"
                disabled={draft.source !== "lever"}
                value={draft.siteName}
                onChange={(event) => update("siteName", event.target.value)}
                placeholder="company"
              />
            </label>
          </div>

          <label className="mt-4 flex items-center gap-3 text-sm font-medium text-slate-700">
            <input
              className="h-4 w-4 rounded border-slate-300 text-emerald-700"
              type="checkbox"
              checked={draft.enabled}
              onChange={(event) => update("enabled", event.target.checked)}
            />
            Enabled
          </label>

          <button
            className="mt-5 inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-ink px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-700"
            type="submit"
          >
            <Plus aria-hidden="true" size={18} />
            Save source
          </button>
        </form>

        <form
          className="rounded-lg border border-line bg-white p-5 shadow-soft"
          onSubmit={handleManualSubmit}
        >
          <div className="flex items-start gap-4">
            <div className="flex h-11 w-11 items-center justify-center rounded-md bg-teal-50 text-teal-700">
              <Link aria-hidden="true" size={22} />
            </div>
            <div>
              <h3 className="text-base font-semibold text-slate-950">
                Manual URL import
              </h3>
              <p className="mt-1 text-sm text-slate-500">
                Stores a queued placeholder for a later crawler/parser.
              </p>
            </div>
          </div>
          <label className="mt-5 block space-y-2">
            <span className="text-sm font-medium text-slate-700">Job URL</span>
            <input
              className="min-h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 shadow-sm"
              type="url"
              value={manualUrl}
              onChange={(event) => setManualUrl(event.target.value)}
              placeholder="https://company.example/jobs/123"
            />
          </label>
          <button
            className="mt-5 inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-slate-300 px-4 text-sm font-semibold text-slate-800 transition hover:bg-slate-50"
            type="submit"
          >
            <Plus aria-hidden="true" size={18} />
            Import placeholder
          </button>
        </form>
      </section>

      <section className="rounded-lg border border-line bg-white p-5 shadow-soft">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className="text-base font-semibold text-slate-950">
              Source configurations
            </h3>
            <p className="mt-1 text-sm text-slate-500">
              Manual scans fetch public postings and log a scan run.
            </p>
          </div>
          {isScanning && (
            <span className="inline-flex items-center gap-2 rounded-md bg-sky-50 px-3 py-2 text-sm font-medium text-sky-700">
              <RefreshCw className="animate-spin" aria-hidden="true" size={16} />
              Scanning
            </span>
          )}
        </div>

        <div className="mt-5 grid gap-3">
          {configs.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-300 bg-panel p-6 text-sm text-slate-500">
              No source configurations yet.
            </div>
          ) : (
            configs.map((config) => (
              <div
                key={config.id}
                className="flex flex-col gap-4 rounded-lg border border-slate-200 p-4 lg:flex-row lg:items-center lg:justify-between"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="font-semibold text-slate-950">
                      {config.displayName}
                    </h4>
                    <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold uppercase tracking-wide text-slate-600">
                      {config.source}
                    </span>
                    <span className="rounded-md bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700">
                      {scheduleLabel(config.schedule)}
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-slate-500">
                    {config.source === "greenhouse"
                      ? `Board token: ${config.boardToken || "missing"}`
                      : `Site name: ${config.siteName || "missing"}`}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    Last scan:{" "}
                    {config.lastScanAt
                      ? new Date(config.lastScanAt).toLocaleString()
                      : "never"}
                  </p>
                </div>
                <button
                  className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-ink px-3 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-400"
                  type="button"
                  disabled={isScanning || !config.enabled}
                  onClick={() => onRunScan(config.id)}
                >
                  <Play aria-hidden="true" size={17} />
                  Run scan
                </button>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[1.1fr_1fr]">
        <div className="overflow-hidden rounded-lg border border-line bg-white shadow-soft">
          <div className="border-b border-line p-5">
            <h3 className="text-base font-semibold text-slate-950">Scan history</h3>
            <p className="mt-1 text-sm text-slate-500">
              Failures keep their error messages visible for operators.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="bg-panel text-slate-600">
                <tr>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold">Source</th>
                  <th className="px-4 py-3 font-semibold">Fetched</th>
                  <th className="px-4 py-3 font-semibold">Inserted</th>
                  <th className="px-4 py-3 font-semibold">Updated</th>
                  <th className="px-4 py-3 font-semibold">Duplicates</th>
                  <th className="px-4 py-3 font-semibold">Error</th>
                </tr>
              </thead>
              <tbody>
                {scanRuns.length === 0 ? (
                  <tr>
                    <td className="px-4 py-5 text-slate-500" colSpan={7}>
                      No scan runs yet.
                    </td>
                  </tr>
                ) : (
                  scanRuns.map((run) => {
                    const StatusIcon =
                      run.status === "succeeded"
                        ? CheckCircle2
                        : run.status === "failed"
                          ? AlertCircle
                          : Clock;

                    return (
                      <tr key={run.id} className="border-t border-slate-200">
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex items-center gap-2 rounded-md px-2 py-1 text-xs font-semibold ${statusTone(run.status)}`}
                          >
                            <StatusIcon aria-hidden="true" size={14} />
                            {run.status}
                          </span>
                        </td>
                        <td className="px-4 py-3">{run.source}</td>
                        <td className="px-4 py-3">{run.jobsFetched}</td>
                        <td className="px-4 py-3">{run.jobsInserted}</td>
                        <td className="px-4 py-3">{run.jobsUpdated}</td>
                        <td className="px-4 py-3">{run.duplicatesSkipped}</td>
                        <td className="max-w-[260px] truncate px-4 py-3 text-red-700">
                          {run.errorMessage || "-"}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="overflow-hidden rounded-lg border border-line bg-white shadow-soft">
          <div className="border-b border-line p-5">
            <h3 className="text-base font-semibold text-slate-950">
              Recently ingested jobs
            </h3>
            <p className="mt-1 text-sm text-slate-500">
              New records stay queued until Phase 3 scoring.
            </p>
          </div>
          <div className="divide-y divide-slate-200">
            {jobs.length === 0 ? (
              <p className="p-5 text-sm text-slate-500">No normalized jobs stored.</p>
            ) : (
              jobs.slice(0, 8).map((job) => (
                <article key={job.id} className="p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <h4 className="truncate text-sm font-semibold text-slate-950">
                        {job.title}
                      </h4>
                      <p className="mt-1 text-sm text-slate-500">
                        {job.company} · {job.location || "Unknown location"}
                      </p>
                    </div>
                    <span className="rounded-md bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-700">
                      {job.scoringStatus}
                    </span>
                  </div>
                  <p className="mt-2 text-xs uppercase tracking-wide text-slate-500">
                    {job.source} · {job.remoteType}
                  </p>
                </article>
              ))
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
