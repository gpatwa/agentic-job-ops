import {
  ArrowRight,
  BriefcaseBusiness,
  ClipboardList,
  FileUp,
  ListChecks,
  UserRound
} from "lucide-react";
import type {
  ApplicationRecord,
  AuditLog,
  ProfileCompletion,
  Resume
} from "../models/domain";
import { CompletionMeter } from "../components/CompletionMeter";
import { ResumeStatusCard } from "../components/ResumeStatusCard";

interface DashboardHomeProps<RouteId extends string> {
  completion: ProfileCompletion;
  resume: Resume | null;
  applications: ApplicationRecord[];
  auditLogs: AuditLog[];
  onNavigate: (route: RouteId) => void;
  routes: {
    profile: RouteId;
    resume: RouteId;
    jobs: RouteId;
    tracker: RouteId;
  };
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

export function DashboardHome<RouteId extends string>({
  completion,
  resume,
  applications,
  auditLogs,
  onNavigate,
  routes
}: DashboardHomeProps<RouteId>) {
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
            Phase 1 captures the profile, resume record, and review surfaces that later
            phases will populate.
          </p>
        </div>
        <button
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-ink px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-700"
          type="button"
          onClick={() => onNavigate(routes.profile)}
        >
          <UserRound aria-hidden="true" size={18} />
          Edit profile
        </button>
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
        <StatCard label="Review queue" value="0" icon={BriefcaseBusiness} />
        <StatCard
          label="Applications tracked"
          value={String(applications.length)}
          icon={ClipboardList}
        />
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
                Apply Review, Maybe, and Browse are ready for scored jobs.
              </p>
            </div>
            <button
              className="inline-flex min-h-10 items-center gap-2 rounded-md border border-slate-300 px-3 text-sm font-semibold text-slate-800 transition hover:bg-slate-50"
              type="button"
              onClick={() => onNavigate(routes.jobs)}
            >
              <ListChecks aria-hidden="true" size={17} />
              Open queues
            </button>
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            {["Apply Review", "Maybe", "Browse"].map((label) => (
              <div
                key={label}
                className="rounded-lg border border-slate-200 bg-panel p-4"
              >
                <p className="text-sm font-medium text-slate-500">{label}</p>
                <p className="mt-2 text-2xl font-semibold text-slate-950">0</p>
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
                  <p className="text-sm font-medium text-slate-800">{log.action}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {new Date(log.createdAt).toLocaleString()}
                  </p>
                </div>
              ))
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
