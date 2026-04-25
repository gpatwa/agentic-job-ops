import { BriefcaseBusiness, Layers3, Search } from "lucide-react";
import { useState } from "react";
import { EmptyState } from "../components/EmptyState";

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

export function JobDashboardPage() {
  const [activeTab, setActiveTab] = useState<QueueTab>("apply_review");
  const selected = tabs.find((tab) => tab.id === activeTab) ?? tabs[0];

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
          Queues are intentionally empty until job ingestion and scoring are added.
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
          <EmptyState
            icon={selected.icon}
            title={selected.title}
            message={selected.message}
          />
        </div>
      </section>
    </div>
  );
}
