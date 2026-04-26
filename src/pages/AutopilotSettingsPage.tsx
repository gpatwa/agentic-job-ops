import {
  AlertTriangle,
  Plus,
  Play,
  RefreshCw,
  Rocket,
  ShieldCheck,
  Trash2
} from "lucide-react";
import { useEffect, useState } from "react";
import type {
  AutopilotPreferredWorkStyle,
  AutopilotRunFrequency,
  AutopilotSettings
} from "../models/domain";
import {
  autopilotPreferredWorkStyles,
  autopilotRunFrequencies
} from "../models/domain";

interface AutopilotSettingsPageProps {
  settings: AutopilotSettings;
  isAutopilotRunning: boolean;
  onUpdateSettings: (
    update: Partial<
      Omit<
        AutopilotSettings,
        | "id"
        | "tenantId"
        | "userId"
        | "createdAt"
        | "requireApprovalBeforeSubmit"
      >
    >
  ) => void;
  onRunAutopilotNow: () => void;
  onOpenActionCenter: () => void;
}

function frequencyLabel(value: AutopilotRunFrequency): string {
  switch (value) {
    case "manual":
      return "Manual only";
    case "daily":
      return "Once a day";
    case "every_6_hours":
      return "Every 6 hours";
  }
}

function workStyleLabel(value: AutopilotPreferredWorkStyle): string {
  if (value === "any") return "Any";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function AutopilotSettingsPage({
  settings,
  isAutopilotRunning,
  onUpdateSettings,
  onRunAutopilotNow,
  onOpenActionCenter
}: AutopilotSettingsPageProps) {
  const [excludedDraft, setExcludedDraft] = useState("");
  const [targetRoleDraft, setTargetRoleDraft] = useState("");
  const [thresholdDraft, setThresholdDraft] = useState(
    settings.highScoreThreshold.toString()
  );
  const [maxPackagesDraft, setMaxPackagesDraft] = useState(
    settings.maxPackagesPerRun.toString()
  );

  useEffect(() => {
    setThresholdDraft(settings.highScoreThreshold.toString());
    setMaxPackagesDraft(settings.maxPackagesPerRun.toString());
  }, [settings.highScoreThreshold, settings.maxPackagesPerRun]);

  function commitThreshold() {
    const value = Number.parseFloat(thresholdDraft);
    if (Number.isFinite(value) && value >= 0 && value <= 10) {
      onUpdateSettings({ highScoreThreshold: value });
    } else {
      setThresholdDraft(settings.highScoreThreshold.toString());
    }
  }

  function commitMaxPackages() {
    const value = Number.parseInt(maxPackagesDraft, 10);
    if (Number.isFinite(value) && value >= 1 && value <= 20) {
      onUpdateSettings({ maxPackagesPerRun: value });
    } else {
      setMaxPackagesDraft(settings.maxPackagesPerRun.toString());
    }
  }

  function addExcludedCompany() {
    const value = excludedDraft.trim();
    if (!value) return;
    if (settings.excludedCompanies.includes(value)) {
      setExcludedDraft("");
      return;
    }
    onUpdateSettings({
      excludedCompanies: [...settings.excludedCompanies, value]
    });
    setExcludedDraft("");
  }

  function removeExcludedCompany(value: string) {
    onUpdateSettings({
      excludedCompanies: settings.excludedCompanies.filter(
        (entry) => entry !== value
      )
    });
  }

  function addTargetRole() {
    const value = targetRoleDraft.trim();
    if (!value) return;
    if (settings.targetRoles.includes(value)) {
      setTargetRoleDraft("");
      return;
    }
    onUpdateSettings({ targetRoles: [...settings.targetRoles, value] });
    setTargetRoleDraft("");
  }

  function removeTargetRole(value: string) {
    onUpdateSettings({
      targetRoles: settings.targetRoles.filter((entry) => entry !== value)
    });
  }

  return (
    <div className="space-y-6">
      <header className="max-w-3xl">
        <p className="text-sm font-semibold uppercase tracking-wide text-emerald-700">
          Autopilot
        </p>
        <h2 className="mt-2 text-3xl font-semibold text-slate-950">
          Autopilot settings
        </h2>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          Decide how much of the job-search workflow Autopilot should handle on
          its own. The system never sends an application without your
          explicit approval.
        </p>
      </header>

      <section className="rounded-lg border border-line bg-white p-5 shadow-soft">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-emerald-50 text-emerald-700">
              <Rocket aria-hidden="true" size={22} />
            </div>
            <div>
              <h3 className="text-base font-semibold text-slate-950">
                {settings.enabled ? "Autopilot is on" : "Autopilot is off"}
              </h3>
              <p className="mt-1 text-sm leading-6 text-slate-600">
                {settings.enabled
                  ? "Autopilot will keep your job queue, scoring, and (optionally) prepared packages up to date."
                  : "Turn Autopilot on to let it score new jobs and prepare packages for review."}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-md px-3 text-sm font-semibold transition ${
                settings.enabled
                  ? "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                  : "bg-emerald-700 text-white hover:bg-emerald-800"
              }`}
              onClick={() => onUpdateSettings({ enabled: !settings.enabled })}
            >
              {settings.enabled ? "Turn off" : "Turn on"}
            </button>
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
              {isAutopilotRunning ? "Running…" : "Run now"}
            </button>
            <button
              type="button"
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              onClick={onOpenActionCenter}
            >
              Open Action Center
            </button>
          </div>
        </div>

        <div className="mt-4 flex items-start gap-2 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900">
          <ShieldCheck aria-hidden="true" size={14} />
          <p>
            Final submission always requires your explicit approval. This
            cannot be turned off.
          </p>
        </div>
      </section>

      <section className="rounded-lg border border-line bg-white p-5 shadow-soft">
        <h3 className="text-base font-semibold text-slate-950">
          Run schedule
        </h3>
        <p className="mt-1 text-sm text-slate-600">
          How often Autopilot should look for new jobs and update your queues.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          {autopilotRunFrequencies.map((value) => (
            <label
              key={value}
              className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm transition ${
                settings.runFrequency === value
                  ? "border-emerald-300 bg-emerald-50 text-emerald-900"
                  : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
              }`}
            >
              <input
                type="radio"
                name="autopilotRunFrequency"
                value={value}
                className="h-4 w-4"
                checked={settings.runFrequency === value}
                onChange={() => onUpdateSettings({ runFrequency: value })}
              />
              <span className="font-semibold">{frequencyLabel(value)}</span>
            </label>
          ))}
        </div>
      </section>

      <section className="rounded-lg border border-line bg-white p-5 shadow-soft">
        <h3 className="text-base font-semibold text-slate-950">
          Automation behaviour
        </h3>
        <div className="mt-3 space-y-4">
          <ToggleRow
            label="Score new jobs automatically"
            description="When new jobs arrive, score them against your profile so the apply queue stays current."
            checked={settings.autoScoreJobs}
            onChange={(checked) => onUpdateSettings({ autoScoreJobs: checked })}
          />
          <ToggleRow
            label="Prepare packages for high-score jobs"
            description="Generate application packages automatically for jobs above your threshold. Submit always remains a separate human approval."
            checked={settings.autoPreparePackagesForHighScoreJobs}
            onChange={(checked) =>
              onUpdateSettings({
                autoPreparePackagesForHighScoreJobs: checked
              })
            }
          />
          <ToggleRow
            label="Require manual review before generating packages"
            description="Pause before package generation to let you confirm the job before any package is built."
            checked={settings.requireReviewBeforePackageGeneration}
            onChange={(checked) =>
              onUpdateSettings({
                requireReviewBeforePackageGeneration: checked
              })
            }
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-sm">
              <span className="font-semibold text-slate-700">
                High-score threshold
              </span>
              <input
                type="number"
                min={0}
                max={10}
                step={0.1}
                value={thresholdDraft}
                onChange={(event) => setThresholdDraft(event.target.value)}
                onBlur={commitThreshold}
                className="min-h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900"
              />
              <p className="text-xs text-slate-500">
                Match scores at or above this value count as high-match jobs.
              </p>
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-semibold text-slate-700">
                Max packages per run
              </span>
              <input
                type="number"
                min={1}
                max={20}
                step={1}
                value={maxPackagesDraft}
                onChange={(event) => setMaxPackagesDraft(event.target.value)}
                onBlur={commitMaxPackages}
                className="min-h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900"
              />
              <p className="text-xs text-slate-500">
                Caps how many packages Autopilot prepares in a single run.
              </p>
            </label>
          </div>
          <label className="block space-y-1 text-sm">
            <span className="font-semibold text-slate-700">
              Preferred work style
            </span>
            <select
              value={settings.preferredWorkStyle}
              onChange={(event) =>
                onUpdateSettings({
                  preferredWorkStyle: event.target
                    .value as AutopilotPreferredWorkStyle
                })
              }
              className="min-h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900"
            >
              {autopilotPreferredWorkStyles.map((value) => (
                <option key={value} value={value}>
                  {workStyleLabel(value)}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      <section className="rounded-lg border border-line bg-white p-5 shadow-soft">
        <h3 className="text-base font-semibold text-slate-950">
          Excluded companies
        </h3>
        <p className="mt-1 text-sm text-slate-600">
          Autopilot will never prepare packages for companies on this list.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={excludedDraft}
            onChange={(event) => setExcludedDraft(event.target.value)}
            placeholder="Add a company"
            className="min-h-10 flex-1 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900"
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                addExcludedCompany();
              }
            }}
          />
          <button
            type="button"
            className="inline-flex min-h-10 items-center gap-1.5 rounded-md bg-ink px-3 text-sm font-semibold text-white transition hover:bg-slate-700"
            onClick={addExcludedCompany}
          >
            <Plus aria-hidden="true" size={14} />
            Add
          </button>
        </div>
        {settings.excludedCompanies.length > 0 && (
          <ul className="mt-3 flex flex-wrap gap-2">
            {settings.excludedCompanies.map((company) => (
              <li
                key={company}
                className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-panel px-2.5 py-1 text-sm text-slate-700"
              >
                {company}
                <button
                  type="button"
                  onClick={() => removeExcludedCompany(company)}
                  className="text-slate-400 transition hover:text-slate-600"
                  aria-label={`Remove ${company}`}
                >
                  <Trash2 aria-hidden="true" size={12} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-lg border border-line bg-white p-5 shadow-soft">
        <h3 className="text-base font-semibold text-slate-950">
          Autopilot target roles
        </h3>
        <p className="mt-1 text-sm text-slate-600">
          Optional. If empty, Autopilot uses your career profile target titles.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={targetRoleDraft}
            onChange={(event) => setTargetRoleDraft(event.target.value)}
            placeholder="Add a target role"
            className="min-h-10 flex-1 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900"
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                addTargetRole();
              }
            }}
          />
          <button
            type="button"
            className="inline-flex min-h-10 items-center gap-1.5 rounded-md bg-ink px-3 text-sm font-semibold text-white transition hover:bg-slate-700"
            onClick={addTargetRole}
          >
            <Plus aria-hidden="true" size={14} />
            Add
          </button>
        </div>
        {settings.targetRoles.length > 0 ? (
          <ul className="mt-3 flex flex-wrap gap-2">
            {settings.targetRoles.map((role) => (
              <li
                key={role}
                className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-panel px-2.5 py-1 text-sm text-slate-700"
              >
                {role}
                <button
                  type="button"
                  onClick={() => removeTargetRole(role)}
                  className="text-slate-400 transition hover:text-slate-600"
                  aria-label={`Remove ${role}`}
                >
                  <Trash2 aria-hidden="true" size={12} />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 inline-flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900">
            <AlertTriangle aria-hidden="true" size={12} />
            No targets set — Autopilot will fall back to your career profile.
          </p>
        )}
      </section>
    </div>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  onChange
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 rounded-md border border-slate-200 bg-panel p-3">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-slate-950">{label}</p>
        <p className="mt-1 text-xs text-slate-500">{description}</p>
      </div>
      <input
        type="checkbox"
        className="mt-1 h-4 w-4 shrink-0"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  );
}
