import {
  AlertTriangle,
  CheckCircle2,
  Lightbulb,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  Users
} from "lucide-react";
import type {
  CompanyIntelligence,
  JobRiskSeverity,
  JobRiskSignal,
  RecruiterLead
} from "../models/domain";

export interface IntelligenceCardProps {
  intelligence: CompanyIntelligence | null;
  riskSignals: JobRiskSignal[];
  recruiterLeads: RecruiterLead[];
  isGenerating?: boolean;
  onGenerate?: () => void;
  onRefresh?: () => void;
  onMarkHelpful?: () => void;
  onMarkNotHelpful?: () => void;
  onDismissRiskSignal?: (signalId: string) => void;
  onUseRecruiterLead?: (leadId: string) => void;
}

function severityToneClasses(severity: JobRiskSeverity): {
  border: string;
  background: string;
  badge: string;
  icon: string;
} {
  if (severity === "high") {
    return {
      border: "border-red-200",
      background: "bg-red-50",
      badge: "bg-red-100 text-red-700",
      icon: "text-red-700"
    };
  }
  if (severity === "medium") {
    return {
      border: "border-amber-200",
      background: "bg-amber-50",
      badge: "bg-amber-100 text-amber-800",
      icon: "text-amber-700"
    };
  }
  return {
    border: "border-slate-200",
    background: "bg-slate-50",
    badge: "bg-slate-200 text-slate-800",
    icon: "text-slate-600"
  };
}

function statusLabel(value: string): string {
  return value.replace(/_/g, " ");
}

export function IntelligenceCard({
  intelligence,
  riskSignals,
  recruiterLeads,
  isGenerating,
  onGenerate,
  onRefresh,
  onMarkHelpful,
  onMarkNotHelpful,
  onDismissRiskSignal,
  onUseRecruiterLead
}: IntelligenceCardProps) {
  const hasHighRisk = riskSignals.some((signal) => signal.severity === "high");

  return (
    <section
      className={`rounded-lg border ${
        hasHighRisk ? "border-red-300" : "border-line"
      } bg-white p-5 shadow-soft`}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <div
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${
              hasHighRisk ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"
            }`}
          >
            <Sparkles aria-hidden="true" size={18} />
          </div>
          <div>
            <h3 className="text-base font-semibold text-slate-950">
              Company intelligence
            </h3>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              Estimated context based on the public posting and your saved
              profile. Always verify before relying on it. Recruiter names are
              never invented; private LinkedIn data is never scraped.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {!intelligence && onGenerate && (
            <button
              type="button"
              className="inline-flex min-h-9 items-center justify-center gap-2 rounded-md bg-ink px-3 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-400"
              onClick={onGenerate}
              disabled={isGenerating}
            >
              {isGenerating ? (
                <RefreshCw className="animate-spin" aria-hidden="true" size={15} />
              ) : (
                <Sparkles aria-hidden="true" size={15} />
              )}
              {isGenerating ? "Generating…" : "Generate intelligence"}
            </button>
          )}
          {intelligence && onRefresh && (
            <button
              type="button"
              className="inline-flex min-h-9 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400"
              onClick={onRefresh}
              disabled={isGenerating}
            >
              <RefreshCw aria-hidden="true" size={15} />
              {isGenerating ? "Refreshing…" : "Refresh"}
            </button>
          )}
        </div>
      </div>

      {!intelligence ? (
        <p className="mt-4 text-sm text-slate-500">
          No intelligence has been generated for this job yet. Generation runs
          locally and only uses the public job posting and your saved profile.
        </p>
      ) : (
        <div className="mt-4 space-y-4">
          <div className="flex flex-wrap gap-2">
            <span className="rounded-md bg-emerald-50 px-2 py-1 text-xs font-semibold capitalize text-emerald-700">
              Estimated · {intelligence.confidence}
            </span>
            <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold capitalize text-slate-700">
              Source: {statusLabel(intelligence.source)}
            </span>
            <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">
              Updated {new Date(intelligence.updatedAt).toLocaleString()}
            </span>
          </div>

          <p className="text-sm leading-6 text-slate-700">{intelligence.summary}</p>

          <div className="grid gap-3 sm:grid-cols-2">
            <DetailRow label="Industry" value={intelligence.industry || "Unspecified"} />
            <DetailRow label="Business model" value={intelligence.businessModel} />
            <DetailRow label="Company size" value={intelligence.companySize} />
            <DetailRow label="Funding stage" value={intelligence.fundingStage} />
          </div>

          <DetailBlock title="Why this company" icon={Lightbulb}>
            <p className="text-sm leading-6 text-slate-700">
              {intelligence.whyThisCompany || "No personalised reasons available."}
            </p>
          </DetailBlock>

          <DetailBlock title="Interview prep notes" icon={CheckCircle2}>
            {intelligence.interviewPrepNotes.length === 0 ? (
              <p className="text-sm text-slate-500">No prep notes generated.</p>
            ) : (
              <ul className="space-y-1 text-sm leading-6 text-slate-700">
                {intelligence.interviewPrepNotes.map((note) => (
                  <li key={note}>• {note}</li>
                ))}
              </ul>
            )}
          </DetailBlock>

          <DetailBlock title="Compensation signals" icon={Sparkles}>
            <p className="text-sm leading-6 text-slate-700">
              {intelligence.compensationSignals}
            </p>
          </DetailBlock>

          <DetailBlock title="Referral strategy" icon={Users}>
            <p className="text-sm leading-6 text-slate-700">
              {intelligence.referralStrategy}
            </p>
          </DetailBlock>

          {(onMarkHelpful || onMarkNotHelpful) && (
            <div className="flex flex-wrap gap-2 pt-2">
              {onMarkHelpful && (
                <button
                  type="button"
                  className="inline-flex min-h-9 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  onClick={onMarkHelpful}
                >
                  <ThumbsUp aria-hidden="true" size={14} /> Helpful
                </button>
              )}
              {onMarkNotHelpful && (
                <button
                  type="button"
                  className="inline-flex min-h-9 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  onClick={onMarkNotHelpful}
                >
                  <ThumbsDown aria-hidden="true" size={14} /> Not helpful
                </button>
              )}
            </div>
          )}
        </div>
      )}

      <div className="mt-5">
        <h4 className="flex items-center gap-2 text-sm font-semibold text-slate-950">
          <ShieldAlert
            aria-hidden="true"
            className={hasHighRisk ? "text-red-700" : "text-slate-600"}
            size={16}
          />
          Risk signals
        </h4>
        {riskSignals.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">
            No risk signals detected. The deterministic checker watches for
            suspicious domains, fee requests, vague descriptions, unrealistic
            salaries, and stale postings.
          </p>
        ) : (
          <ul className="mt-2 space-y-2">
            {riskSignals.map((signal) => {
              const tone = severityToneClasses(signal.severity);
              return (
                <li
                  key={signal.id}
                  className={`rounded-md border ${tone.border} ${tone.background} p-3`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start gap-2">
                      <AlertTriangle
                        aria-hidden="true"
                        className={`mt-0.5 shrink-0 ${tone.icon}`}
                        size={15}
                      />
                      <div>
                        <p className="text-sm font-semibold text-slate-900">
                          {statusLabel(signal.riskType)}{" "}
                          <span
                            className={`ml-2 rounded-md px-2 py-0.5 text-xs font-semibold capitalize ${tone.badge}`}
                          >
                            {signal.severity}
                          </span>
                        </p>
                        <p className="mt-1 text-sm leading-6 text-slate-700">
                          {signal.explanation}
                        </p>
                        {signal.recommendedAction && (
                          <p className="mt-1 text-xs leading-5 text-slate-600">
                            Recommended: {signal.recommendedAction}
                          </p>
                        )}
                      </div>
                    </div>
                    {onDismissRiskSignal && (
                      <button
                        type="button"
                        className="shrink-0 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                        onClick={() => onDismissRiskSignal(signal.id)}
                      >
                        Dismiss
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="mt-5">
        <h4 className="flex items-center gap-2 text-sm font-semibold text-slate-950">
          <Users aria-hidden="true" className="text-slate-600" size={16} />
          Recruiter leads
        </h4>
        {recruiterLeads.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">
            No recruiter leads recorded for this job. Recruiter names are
            entered manually; the assistant never harvests them from private
            sources.
          </p>
        ) : (
          <ul className="mt-2 space-y-2">
            {recruiterLeads.map((lead) => (
              <li
                key={lead.id}
                className="rounded-md border border-slate-200 bg-panel p-3 text-sm leading-6 text-slate-700"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold text-slate-900">
                      {lead.name || "Unnamed lead"}
                      {lead.title && ` — ${lead.title}`}
                    </p>
                    {lead.publicProfileUrl && (
                      <a
                        className="text-xs text-emerald-700 underline"
                        href={lead.publicProfileUrl}
                        rel="noreferrer"
                        target="_blank"
                      >
                        {lead.publicProfileUrl}
                      </a>
                    )}
                    <p className="mt-1 text-xs text-slate-600">
                      {lead.outreachSuggestion}
                    </p>
                  </div>
                  {onUseRecruiterLead && (
                    <button
                      type="button"
                      className="shrink-0 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                      onClick={() => onUseRecruiterLead(lead.id)}
                    >
                      Mark used
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-slate-200 bg-panel p-3">
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-sm font-medium capitalize text-slate-800">
        {value || "Unspecified"}
      </p>
    </div>
  );
}

function DetailBlock({
  title,
  icon: Icon,
  children
}: {
  title: string;
  icon: typeof Lightbulb;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        <Icon aria-hidden="true" size={14} /> {title}
      </p>
      <div className="mt-2">{children}</div>
    </div>
  );
}
