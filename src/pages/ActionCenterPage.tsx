import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Inbox,
  Send,
  ShieldCheck,
  Snowflake,
  Sparkles,
  X
} from "lucide-react";
import { useMemo } from "react";
import type {
  AutopilotAction,
  AutopilotActionType,
  AutopilotActionUrgency
} from "../models/domain";
import { EmptyState } from "../components/EmptyState";

interface ActionCenterPageProps {
  actions: AutopilotAction[];
  onPrimaryCta: (action: AutopilotAction) => void;
  onSecondaryCta: (action: AutopilotAction) => void;
  onCompleteAction: (actionId: string) => void;
  onDismissAction: (actionId: string) => void;
  onSnoozeAction: (actionId: string) => void;
  isAutopilotEnabled: boolean;
  onTryRealisticDemo?: () => void;
  onClearWorkspace?: () => void;
}

const TYPE_ICON: Record<AutopilotActionType, typeof Bell> = {
  approve_submit: ShieldCheck,
  approve_browser_fill: Send,
  review_application_package: ClipboardList,
  review_high_match_job: Sparkles,
  follow_up_due: Bell,
  interview_note_needed: ClipboardList,
  add_missing_work_authorization: AlertTriangle,
  add_salary_preference: AlertTriangle,
  add_linkedin_url: AlertTriangle,
  review_resume_warning: AlertTriangle
};

function urgencyClasses(urgency: AutopilotActionUrgency, isSubmit: boolean) {
  if (isSubmit) {
    return {
      border: "border-emerald-300",
      background: "bg-emerald-50",
      badge: "bg-emerald-700 text-white"
    };
  }
  if (urgency === "high") {
    return {
      border: "border-amber-300",
      background: "bg-amber-50",
      badge: "bg-amber-200 text-amber-900"
    };
  }
  if (urgency === "medium") {
    return {
      border: "border-sky-200",
      background: "bg-sky-50",
      badge: "bg-sky-100 text-sky-800"
    };
  }
  return {
    border: "border-slate-200",
    background: "bg-white",
    badge: "bg-slate-100 text-slate-700"
  };
}

function ActionCard({
  action,
  onPrimaryCta,
  onSecondaryCta,
  onCompleteAction,
  onDismissAction,
  onSnoozeAction
}: {
  action: AutopilotAction;
  onPrimaryCta: ActionCenterPageProps["onPrimaryCta"];
  onSecondaryCta: ActionCenterPageProps["onSecondaryCta"];
  onCompleteAction: ActionCenterPageProps["onCompleteAction"];
  onDismissAction: ActionCenterPageProps["onDismissAction"];
  onSnoozeAction: ActionCenterPageProps["onSnoozeAction"];
}) {
  const Icon = TYPE_ICON[action.type];
  const isSubmit = action.type === "approve_submit";
  const tone = urgencyClasses(action.urgency, isSubmit);

  return (
    <article
      className={`rounded-lg border ${tone.border} ${tone.background} p-4 shadow-soft`}
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-start gap-3">
          <div
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-md ${
              isSubmit ? "bg-emerald-700 text-white" : "bg-white text-slate-700"
            }`}
          >
            <Icon aria-hidden="true" size={18} />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-base font-semibold text-slate-950">
                {action.title}
              </h3>
              <span
                className={`rounded-md px-2 py-0.5 text-xs font-semibold uppercase tracking-wide ${tone.badge}`}
              >
                {isSubmit ? "Approval" : action.urgency}
              </span>
            </div>
            <p className="mt-2 text-sm leading-6 text-slate-700">
              {action.reason}
            </p>
            {isSubmit && (
              <p className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-white/70 px-2 py-1 text-xs font-semibold text-emerald-900">
                <ShieldCheck aria-hidden="true" size={12} />
                Final submit always requires your explicit approval — autopilot
                cannot send.
              </p>
            )}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2 lg:flex-nowrap">
          <button
            type="button"
            className={`inline-flex min-h-9 items-center gap-1.5 rounded-md px-3 text-xs font-semibold transition ${
              isSubmit
                ? "bg-emerald-700 text-white hover:bg-emerald-800"
                : "bg-ink text-white hover:bg-slate-700"
            }`}
            onClick={() => onPrimaryCta(action)}
          >
            {action.primaryCtaLabel}
            <ChevronRight aria-hidden="true" size={13} />
          </button>
          {action.secondaryCtaLabel && (
            <button
              type="button"
              className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
              onClick={() => onSecondaryCta(action)}
            >
              {action.secondaryCtaLabel}
            </button>
          )}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-end gap-2 border-t border-slate-200/60 pt-3">
        <button
          type="button"
          className="inline-flex min-h-8 items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-50"
          onClick={() => onCompleteAction(action.id)}
        >
          <CheckCircle2 aria-hidden="true" size={12} />
          Mark done
        </button>
        {!isSubmit && (
          <>
            <button
              type="button"
              className="inline-flex min-h-8 items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-50"
              onClick={() => onSnoozeAction(action.id)}
            >
              <Snowflake aria-hidden="true" size={12} />
              Snooze
            </button>
            <button
              type="button"
              className="inline-flex min-h-8 items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-500 transition hover:bg-slate-50"
              onClick={() => onDismissAction(action.id)}
            >
              <X aria-hidden="true" size={12} />
              Dismiss
            </button>
          </>
        )}
      </div>
    </article>
  );
}

export function ActionCenterPage({
  actions,
  onPrimaryCta,
  onSecondaryCta,
  onCompleteAction,
  onDismissAction,
  onSnoozeAction,
  isAutopilotEnabled,
  onTryRealisticDemo,
  onClearWorkspace
}: ActionCenterPageProps) {
  const grouped = useMemo(() => {
    const submit = actions.filter((action) => action.type === "approve_submit");
    const high = actions.filter(
      (action) => action.urgency === "high" && action.type !== "approve_submit"
    );
    const medium = actions.filter(
      (action) =>
        action.urgency === "medium" && action.type !== "approve_submit"
    );
    const low = actions.filter(
      (action) => action.urgency === "low" && action.type !== "approve_submit"
    );
    return { submit, high, medium, low };
  }, [actions]);

  return (
    <div className="space-y-6">
      <header className="max-w-3xl">
        <p className="text-sm font-semibold uppercase tracking-wide text-emerald-700">
          Action Center
        </p>
        <h2 className="mt-2 text-3xl font-semibold text-slate-950">
          Decisions waiting for you
        </h2>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          Autopilot does the work; you make the call. This page only shows
          decisions the system needs from you. Final submit is always a
          human-only action.
        </p>
        {!isAutopilotEnabled && (
          <p className="mt-3 inline-flex items-center gap-2 rounded-md bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700">
            <Bell aria-hidden="true" size={12} />
            Autopilot is currently off. Turn it on in Autopilot settings to
            populate this page automatically.
          </p>
        )}
      </header>

      {actions.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title="Nothing waiting on you"
          message="Autopilot will surface decisions here when it has high-match jobs, prepared packages, or missing context that blocks an application."
          actionLabel={onTryRealisticDemo ? "Try realistic demo" : undefined}
          onAction={onTryRealisticDemo}
        />
      ) : (
        <div className="space-y-6">
          {grouped.submit.length > 0 && (
            <section className="space-y-3">
              <header>
                <h3 className="text-base font-semibold text-emerald-900">
                  Final submit approvals
                </h3>
                <p className="mt-1 text-sm text-slate-600">
                  These are the only actions that send applications. Always
                  reviewed and approved by you.
                </p>
              </header>
              <div className="space-y-3">
                {grouped.submit.map((action) => (
                  <ActionCard
                    key={action.id}
                    action={action}
                    onPrimaryCta={onPrimaryCta}
                    onSecondaryCta={onSecondaryCta}
                    onCompleteAction={onCompleteAction}
                    onDismissAction={onDismissAction}
                    onSnoozeAction={onSnoozeAction}
                  />
                ))}
              </div>
            </section>
          )}
          {grouped.high.length > 0 && (
            <section className="space-y-3">
              <header>
                <h3 className="text-base font-semibold text-amber-900">
                  High urgency
                </h3>
              </header>
              <div className="space-y-3">
                {grouped.high.map((action) => (
                  <ActionCard
                    key={action.id}
                    action={action}
                    onPrimaryCta={onPrimaryCta}
                    onSecondaryCta={onSecondaryCta}
                    onCompleteAction={onCompleteAction}
                    onDismissAction={onDismissAction}
                    onSnoozeAction={onSnoozeAction}
                  />
                ))}
              </div>
            </section>
          )}
          {grouped.medium.length > 0 && (
            <section className="space-y-3">
              <header>
                <h3 className="text-base font-semibold text-sky-900">
                  Medium urgency
                </h3>
              </header>
              <div className="space-y-3">
                {grouped.medium.map((action) => (
                  <ActionCard
                    key={action.id}
                    action={action}
                    onPrimaryCta={onPrimaryCta}
                    onSecondaryCta={onSecondaryCta}
                    onCompleteAction={onCompleteAction}
                    onDismissAction={onDismissAction}
                    onSnoozeAction={onSnoozeAction}
                  />
                ))}
              </div>
            </section>
          )}
          {grouped.low.length > 0 && (
            <section className="space-y-3">
              <header>
                <h3 className="text-base font-semibold text-slate-700">
                  Optional
                </h3>
              </header>
              <div className="space-y-3">
                {grouped.low.map((action) => (
                  <ActionCard
                    key={action.id}
                    action={action}
                    onPrimaryCta={onPrimaryCta}
                    onSecondaryCta={onSecondaryCta}
                    onCompleteAction={onCompleteAction}
                    onDismissAction={onDismissAction}
                    onSnoozeAction={onSnoozeAction}
                  />
                ))}
              </div>
            </section>
          )}
        </div>
      )}
      {onClearWorkspace && (
        <section className="rounded-lg border border-dashed border-slate-300 bg-white p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-slate-900">
                Local demo workspace
              </p>
              <p className="mt-1 text-sm leading-6 text-slate-500">
                Clear local data when you want to restart the demo from a clean state.
              </p>
            </div>
            <button
              type="button"
              className="inline-flex min-h-10 items-center justify-center rounded-md border border-red-200 bg-red-50 px-3 text-sm font-semibold text-red-700 transition hover:bg-red-100"
              onClick={onClearWorkspace}
            >
              Clear local workspace
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
