import { BriefcaseBusiness, Layers3, Search } from "lucide-react";
import { useState } from "react";
import { EmptyState } from "../components/EmptyState";
import type { NormalizedJob } from "../models/domain";

type QueueTab = "apply_review" | "maybe" | "browse";

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
    title: "No jobs ready for review",
    message:
      "Scored jobs that look actionable will appear here after ingestion and matching are implemented."
  },
  {
    id: "maybe",
    label: "Maybe",
    icon: Layers3,
    title: "No maybe jobs yet",
    message:
      "Borderline matches will be held here for user review after the match engine is added."
  },
  {
    id: "browse",
    label: "Browse",
    icon: Search,
    title: "No browse jobs yet",
    message:
      "Lower-priority discovered jobs will appear here once Phase 2 ingestion feeds the dashboard."
  }
];

interface JobDashboardPageProps {
  jobs: NormalizedJob[];
}

export function JobDashboardPage({ jobs }: JobDashboardPageProps) {
  const [activeTab, setActiveTab] = useState<QueueTab>("apply_review");
  const selected = tabs.find((tab) => tab.id === activeTab) ?? tabs[0];
  const queuedJobs = jobs.filter((job) => job.scoringStatus === "queued");

  return (
    <div className="space-y-6">
      <header className="max-w-3xl">
        <p className="text-sm font-semibold uppercase tracking-wide text-emerald-700">
          Jobs
        </p>
        <h2 className="mt-2 text-3xl font-semibold text-slate-950">
          Job dashboard
        </h2>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          Ingested jobs remain queued until Phase 3 scoring assigns them to Apply
          Review, Maybe, or Browse.
        </p>
      </header>

      <section className="rounded-lg border border-line bg-white p-5 shadow-soft">
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Job queues">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const active = tab.id === activeTab;

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
              </button>
            );
          })}
        </div>

        <div className="mt-5" role="tabpanel">
          {activeTab === "browse" && queuedJobs.length > 0 ? (
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="bg-panel text-slate-600">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Title</th>
                    <th className="px-4 py-3 font-semibold">Company</th>
                    <th className="px-4 py-3 font-semibold">Location</th>
                    <th className="px-4 py-3 font-semibold">Source</th>
                    <th className="px-4 py-3 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {queuedJobs.map((job) => (
                    <tr key={job.id} className="border-t border-slate-200">
                      <td className="px-4 py-3 font-medium text-slate-950">
                        {job.title}
                      </td>
                      <td className="px-4 py-3">{job.company}</td>
                      <td className="px-4 py-3">{job.location || "Unknown"}</td>
                      <td className="px-4 py-3">{job.source}</td>
                      <td className="px-4 py-3">{job.scoringStatus}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
