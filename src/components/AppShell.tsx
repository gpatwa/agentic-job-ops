import type { LucideIcon } from "lucide-react";
import { ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
import type { AppSession, ProfileCompletion, Resume } from "../models/domain";
import { CompletionMeter } from "./CompletionMeter";

export interface NavigationItem<RouteId extends string = string> {
  id: RouteId;
  label: string;
  icon: LucideIcon;
  section?: "primary" | "advanced";
}

interface AppShellProps<RouteId extends string> {
  children: ReactNode;
  currentRoute: RouteId;
  navigationItems: NavigationItem<RouteId>[];
  session: AppSession;
  completion: ProfileCompletion;
  resume: Resume | null;
  onNavigate: (route: RouteId) => void;
}

function resumeDisplayName(resume: Resume): string {
  const normalizedName = resume.originalFileName.toLowerCase();
  return normalizedName.includes("placeholder") && normalizedName.includes("resume")
    ? "Resume record"
    : resume.originalFileName;
}

function navigationTestId(id: string): string {
  if (id === "jobs") return "job-matches-nav";
  if (id === "tracker") return "tracker-nav";
  if (id === "admin") return "admin-nav";
  return `${id}-nav`;
}

export function AppShell<RouteId extends string>({
  children,
  currentRoute,
  navigationItems,
  session,
  completion,
  resume,
  onNavigate
}: AppShellProps<RouteId>) {
  const primaryItems = navigationItems.filter(
    (item) => item.section !== "advanced"
  );
  const advancedItems = navigationItems.filter(
    (item) => item.section === "advanced"
  );
  const renderItem = (item: NavigationItem<RouteId>) => {
    const Icon = item.icon;
    const active = item.id === currentRoute;

    return (
      <button
        key={item.id}
        className={`flex min-h-11 shrink-0 items-center gap-3 rounded-md px-3 text-left text-sm font-medium transition ${
          active
            ? "bg-emerald-50 text-emerald-800"
            : "text-slate-600 hover:bg-slate-100 hover:text-slate-950"
        }`}
        data-testid={navigationTestId(item.id)}
        type="button"
        onClick={() => onNavigate(item.id)}
      >
        <Icon aria-hidden="true" size={19} />
        <span>{item.label}</span>
      </button>
    );
  };

  return (
    <div className="min-h-screen bg-[#eef1ea] text-ink">
      <div className="mx-auto flex min-h-screen max-w-[1500px] flex-col lg:flex-row">
        <aside className="border-b border-line bg-white px-4 py-4 lg:min-h-screen lg:w-72 lg:border-b-0 lg:border-r lg:px-5 lg:py-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-md bg-ink text-white">
              <ShieldCheck aria-hidden="true" size={22} />
            </div>
            <div>
              <p className="text-sm font-semibold tracking-wide text-slate-500">
                Agentic Job Ops
              </p>
              <h1 className="text-base font-semibold text-slate-950">
                {session.tenant.name}
              </h1>
            </div>
          </div>

          <nav className="mt-6 flex flex-col gap-4">
            <div className="flex gap-2 overflow-x-auto lg:flex-col lg:overflow-visible">
              {primaryItems.map(renderItem)}
            </div>
            {advancedItems.length > 0 && (
              <div>
                <p className="px-3 text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Advanced
                </p>
                <div className="mt-2 flex gap-2 overflow-x-auto lg:flex-col lg:overflow-visible">
                  {advancedItems.map(renderItem)}
                </div>
              </div>
            )}
          </nav>

          <div className="mt-6 hidden rounded-lg border border-line bg-panel p-4 lg:block">
            <CompletionMeter completion={completion} />
          </div>

          <div className="mt-4 hidden rounded-lg border border-line bg-white p-4 text-sm text-slate-600 lg:block">
            <p className="font-medium text-slate-800">Resume</p>
            <p className="mt-1 truncate">
              {resume ? resumeDisplayName(resume) : "Not uploaded"}
            </p>
          </div>
        </aside>

        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</main>
      </div>
    </div>
  );
}
