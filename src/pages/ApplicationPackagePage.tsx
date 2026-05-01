import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  ExternalLink,
  FileText,
  Paperclip,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  XCircle
} from "lucide-react";
import { useEffect, useState } from "react";
import { EmptyState } from "../components/EmptyState";
import { IntelligenceCard } from "../components/IntelligenceCard";
import type {
  ApplicationAnswer,
  BrowserApplicationSession,
  ApplicationPackage,
  ApplicationRecord,
  CompanyIntelligence,
  JobMatch,
  JobRiskSignal,
  NormalizedJob,
  RecruiterLead
} from "../models/domain";

interface ApplicationPackagePageProps {
  applicationPackage: ApplicationPackage | null;
  answers: ApplicationAnswer[];
  application: ApplicationRecord | null;
  job: NormalizedJob | null;
  match: JobMatch | null;
  browserSession: BrowserApplicationSession | null;
  intelligence: CompanyIntelligence | null;
  riskSignals: JobRiskSignal[];
  recruiterLeads: RecruiterLead[];
  isGeneratingIntelligence: boolean;
  /**
   * Original filename of the resume attached to this application
   * (e.g. "GopalPatwa-Resume.pdf"). Surfaced in a "Resume attached"
   * badge near the resume draft so the user knows which file the
   * browser-application assistant will upload at submit time.
   */
  resumeFileName?: string;
  /**
   * True while the LLM is regenerating the package (e.g. after the
   * user opted in to a cover letter). Disables the opt-in button to
   * prevent double-submits.
   */
  isRegeneratingPackage?: boolean;
  onBack: () => void;
  onSavePackage: (
    packageId: string,
    updates: { resumeMarkdown: string; coverLetter: string }
  ) => void;
  onSaveAnswer: (answerId: string, answer: string) => void;
  onApprove: (packageId: string) => void;
  onReject: (packageId: string) => void;
  onStartBrowserApply: (packageId: string) => void;
  onOpenBrowserSession: (sessionId: string) => void;
  /**
   * Opt the user into a cover letter for this package. Defined when
   * the LLM regeneration is plumbed through; when undefined (e.g.
   * tests) the opt-in button is not rendered.
   */
  onGenerateCoverLetter?: (packageId: string) => void;
  /**
   * Opt the user into short-answer drafts for this package. Same
   * pattern as `onGenerateCoverLetter` — if the application form
   * actually asks free-text questions, click this to generate
   * drafts. Saved-library entries are reused first; only un-cached
   * questions go to the LLM.
   */
  onGenerateShortAnswers?: (packageId: string) => void;
  /**
   * Re-run the full LLM generation pass against the current job /
   * profile / resume data. Surfaced as a "Regenerate" button next
   * to the metadata + as the action on the stale-job banner.
   * Preserves `coverLetterIncluded` + `shortAnswersIncluded` flags
   * so opt-ins survive the regen.
   */
  onRegeneratePackage?: (packageId: string) => void;
  /**
   * True when the persisted package references the URL-import
   * placeholder ("Imported job pending enrichment") but the
   * underlying job has since been enriched. Driven by
   * `isPackageStaleAfterJobEnrichment`. When true, the page shows
   * an amber banner suggesting regeneration.
   */
  isStaleAfterJobEnrichment?: boolean;
  onGenerateIntelligence: () => void;
  onMarkIntelligenceHelpful: () => void;
  onMarkIntelligenceNotHelpful: () => void;
  onDismissRiskSignal: (signalId: string) => void;
}

function statusLabel(value: string): string {
  return value.replace(/_/g, " ");
}

function userFacingJobCopy(value: string): string {
  return value.toLowerCase().includes("manual import queued")
    ? "Manually imported job"
    : value;
}

function confidenceTone(confidence: ApplicationAnswer["confidence"]): string {
  if (confidence === "high") {
    return "bg-emerald-50 text-emerald-700";
  }

  if (confidence === "medium") {
    return "bg-amber-50 text-amber-700";
  }

  return "bg-red-50 text-red-700";
}

function packageStatusMessage(applicationPackage: ApplicationPackage): string {
  if (
    applicationPackage.status === "draft" ||
    applicationPackage.status === "ready_for_review"
  ) {
    return "This package is ready for review and edits.";
  }

  if (applicationPackage.status === "approved") {
    return "This package is ready for browser application assistant.";
  }

  return "This package needs review or regenerate before applying.";
}

function DraftPreview({ text }: { text: string }) {
  return (
    <div className="max-h-[420px] overflow-auto rounded-md border border-slate-200 bg-panel p-4">
      <pre className="whitespace-pre-wrap font-sans text-sm leading-6 text-slate-700">
        {text || "No draft content yet."}
      </pre>
    </div>
  );
}

function AnswerEditor({
  answer,
  onSaveAnswer
}: {
  answer: ApplicationAnswer;
  onSaveAnswer: (answerId: string, answer: string) => void;
}) {
  const [draft, setDraft] = useState(answer.answer);

  useEffect(() => {
    setDraft(answer.answer);
  }, [answer.answer]);

  return (
    <article className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h4 className="text-sm font-semibold text-slate-950">{answer.question}</h4>
          <div className="mt-2 flex flex-wrap gap-2">
            <span
              className={`rounded-md px-2 py-1 text-xs font-semibold capitalize ${confidenceTone(answer.confidence)}`}
            >
              {answer.confidence} confidence
            </span>
            {answer.source === "saved_library" ? (
              <span
                className="rounded-md bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700"
                data-testid="answer-source-saved-library"
              >
                From your saved answers
              </span>
            ) : (
              <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold capitalize text-slate-700">
                {statusLabel(answer.source)}
              </span>
            )}
            {answer.needsUserReview && (
              <span className="rounded-md bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-700">
                Needs review
              </span>
            )}
          </div>
        </div>
        <button
          className="inline-flex min-h-9 items-center justify-center rounded-md border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
          type="button"
          onClick={() => onSaveAnswer(answer.id, draft)}
        >
          Save answer
        </button>
      </div>
      <textarea
        className="mt-3 min-h-28 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm leading-6 text-slate-900"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
      />
    </article>
  );
}

export function ApplicationPackagePage({
  applicationPackage,
  answers,
  application,
  job,
  match,
  browserSession,
  intelligence,
  riskSignals,
  recruiterLeads,
  isGeneratingIntelligence,
  resumeFileName,
  isRegeneratingPackage,
  onBack,
  onSavePackage,
  onSaveAnswer,
  onApprove,
  onReject,
  onStartBrowserApply,
  onOpenBrowserSession,
  onGenerateCoverLetter,
  onGenerateShortAnswers,
  onRegeneratePackage,
  isStaleAfterJobEnrichment,
  onGenerateIntelligence,
  onMarkIntelligenceHelpful,
  onMarkIntelligenceNotHelpful,
  onDismissRiskSignal
}: ApplicationPackagePageProps) {
  const [resumeDraft, setResumeDraft] = useState(
    applicationPackage?.resumeMarkdown ?? ""
  );
  const [coverLetterDraft, setCoverLetterDraft] = useState(
    applicationPackage?.coverLetter ?? ""
  );

  useEffect(() => {
    setResumeDraft(applicationPackage?.resumeMarkdown ?? "");
    setCoverLetterDraft(applicationPackage?.coverLetter ?? "");
  }, [applicationPackage?.coverLetter, applicationPackage?.resumeMarkdown]);

  if (!applicationPackage || !job) {
    return (
      <EmptyState
        icon={FileText}
        title="Application package not found"
        message="Start application prep from a scored job to generate a reviewable package."
        actionLabel="Back to tracker"
        onAction={onBack}
      />
    );
  }

  const canApprove = applicationPackage.status !== "approved";
  const canReject = applicationPackage.status !== "rejected";

  return (
    <div className="space-y-6" data-testid="application-package-page">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-3xl">
          <p className="text-sm font-semibold uppercase tracking-wide text-emerald-700">
            Application Package
          </p>
          <h2 className="mt-2 text-3xl font-semibold text-slate-950">
            {userFacingJobCopy(job.title)} at {job.company}
          </h2>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            {packageStatusMessage(applicationPackage)} Review the tailored resume
            draft, cover letter draft, and short-answer drafts before any
            application work continues.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {match && (
              <span className="rounded-md bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700">
                {match.overallScore.toFixed(1)} / 10 match
              </span>
            )}
            <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold capitalize text-slate-700">
              Package {statusLabel(applicationPackage.status)}
            </span>
            {application && (
              <span className="rounded-md bg-blue-50 px-2 py-1 text-xs font-semibold capitalize text-blue-700">
                Tracker {statusLabel(application.status)}
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            className="inline-flex min-h-10 items-center justify-center rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            type="button"
            onClick={onBack}
          >
            Back to tracker
          </button>
          {browserSession && (
            <button
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              type="button"
              onClick={() => onOpenBrowserSession(browserSession.id)}
            >
              <ExternalLink aria-hidden="true" size={17} />
              Open browser session
            </button>
          )}
          {!browserSession && applicationPackage.status === "approved" && (
            <button
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-emerald-700 px-3 text-sm font-semibold text-white transition hover:bg-emerald-800"
              data-testid="start-browser-apply-demo"
              type="button"
              onClick={() => onStartBrowserApply(applicationPackage.id)}
            >
              <Bot aria-hidden="true" size={17} />
              Start browser apply
            </button>
          )}
          <button
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 text-sm font-semibold text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
            type="button"
            disabled={!canReject}
            onClick={() => onReject(applicationPackage.id)}
          >
            <XCircle aria-hidden="true" size={17} />
            Reject
          </button>
          <button
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-ink px-3 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-400"
            data-testid="approve-package"
            type="button"
            disabled={!canApprove}
            onClick={() => onApprove(applicationPackage.id)}
          >
            <CheckCircle2 aria-hidden="true" size={17} />
            Approve
          </button>
        </div>
      </header>

      {/*
        Stale-after-enrichment banner. Fires when the persisted
        package still references the URL-import placeholder
        ("Imported job pending enrichment") but the underlying job
        has since been enriched via the Greenhouse / Lever single-
        job API. Without this, a candidate could submit drafts that
        literally name the placeholder.
      */}
      {isStaleAfterJobEnrichment && (
        <section
          className="rounded-lg border border-amber-300 bg-amber-50 p-4"
          data-testid="package-stale-banner"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex gap-3">
              <RefreshCw
                aria-hidden="true"
                className="mt-0.5 shrink-0 text-amber-700"
                size={18}
              />
              <div>
                <h3 className="text-sm font-semibold text-amber-900">
                  Job details have refreshed since this package was generated
                </h3>
                <p className="mt-1 text-sm leading-6 text-amber-800">
                  The drafts below still reference the import-time placeholder
                  title. Regenerate to use the enriched job title, company, and
                  description. Cover-letter and short-answer opt-ins are
                  preserved.
                </p>
              </div>
            </div>
            {onRegeneratePackage && (
              <button
                className="inline-flex min-h-9 shrink-0 items-center justify-center gap-2 rounded-md bg-amber-700 px-3 text-xs font-semibold text-white transition hover:bg-amber-800 disabled:cursor-not-allowed disabled:bg-amber-400"
                data-testid="regenerate-from-stale-banner"
                type="button"
                disabled={Boolean(isRegeneratingPackage)}
                onClick={() => onRegeneratePackage(applicationPackage.id)}
              >
                <RefreshCw aria-hidden="true" size={13} />
                {isRegeneratingPackage ? "Regenerating…" : "Regenerate package"}
              </button>
            )}
          </div>
        </section>
      )}

      {applicationPackage.safetyWarnings.length > 0 ? (
        <section className="rounded-lg border border-amber-200 bg-amber-50 p-4">
          <div className="flex gap-3">
            <AlertTriangle
              aria-hidden="true"
              className="mt-0.5 shrink-0 text-amber-700"
              size={18}
            />
            <div>
              <h3 className="text-sm font-semibold text-amber-900">
                Safety warnings
              </h3>
              <ul className="mt-2 space-y-1 text-sm leading-6 text-amber-800">
                {applicationPackage.safetyWarnings.map((warning) => (
                  <li key={warning}>- {warning}</li>
                ))}
              </ul>
            </div>
          </div>
        </section>
      ) : null}
      {/*
        Removed the "No unsupported-claim warnings are currently
        detected" green banner — silence is success here. Showing
        an absence-of-problems banner permanently is debug noise
        for the candidate. Warnings still surface loudly when
        present (above), which is what matters.
      */}

      {/*
        Inline regenerate action — primary surface lives here next to
        the resume draft instead of behind the disclosure.
      */}
      {onRegeneratePackage && (
        <div className="flex items-center justify-end">
          <button
            className="inline-flex min-h-7 items-center justify-center gap-1 rounded-md border border-slate-300 bg-white px-2 text-[11px] font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            data-testid="regenerate-package"
            type="button"
            disabled={Boolean(isRegeneratingPackage)}
            onClick={() => onRegeneratePackage(applicationPackage.id)}
            title="Regenerate drafts using the current job and profile data"
          >
            <RefreshCw aria-hidden="true" size={11} />
            {isRegeneratingPackage ? "Regenerating…" : "Regenerate drafts"}
          </button>
        </div>
      )}

      {/*
        Generation / Integrity / Review metadata — collapsed by
        default. These are debug fields (model name, prompt version,
        input/output hashes, last-updated timestamp, answer count)
        useful for operators but distracting for the candidate.
        Consolidated into one disclosure to reduce visual noise.
      */}
      <details className="rounded-lg border border-line bg-white shadow-soft" data-testid="package-debug-details">
        <summary className="cursor-pointer list-none p-4 text-xs font-semibold uppercase tracking-wide text-slate-500 hover:bg-slate-50">
          Generation details ▾
        </summary>
        <div className="grid gap-4 border-t border-slate-100 p-4 xl:grid-cols-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Generation
            </p>
            <dl className="mt-3 space-y-2 text-sm text-slate-600">
              <div>
                <dt className="font-medium text-slate-800">Mode</dt>
                <dd className="capitalize">{applicationPackage.generationMode}</dd>
              </div>
              <div>
                <dt className="font-medium text-slate-800">Model</dt>
                <dd>{applicationPackage.modelName}</dd>
              </div>
              <div>
                <dt className="font-medium text-slate-800">Prompt</dt>
                <dd>{applicationPackage.promptVersion}</dd>
              </div>
            </dl>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Integrity
            </p>
            <dl className="mt-3 space-y-2 text-sm text-slate-600">
              <div>
                <dt className="font-medium text-slate-800">Input hash</dt>
                <dd>{applicationPackage.inputHash}</dd>
              </div>
              <div>
                <dt className="font-medium text-slate-800">Output hash</dt>
                <dd>{applicationPackage.outputHash}</dd>
              </div>
            </dl>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Review
            </p>
            <dl className="mt-3 space-y-2 text-sm text-slate-600">
              <div>
                <dt className="font-medium text-slate-800">Updated</dt>
                <dd>{new Date(applicationPackage.updatedAt).toLocaleString()}</dd>
              </div>
              <div>
                <dt className="font-medium text-slate-800">Answers</dt>
                <dd>{answers.length}</dd>
              </div>
            </dl>
          </div>
        </div>
      </details>

      <section className="rounded-lg border border-line bg-white p-5 shadow-soft">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h3 className="text-base font-semibold text-slate-950">
              Resume draft
            </h3>
            <p className="mt-1 text-sm text-slate-500">
              Tailored from verified profile facts, parsed resume evidence, and the
              job description.
            </p>
            {/* Resume-attached badge — surfaces the actual file the
                browser-application assistant will upload at submit
                time. The tailored markdown above is a preview /
                edit surface; the underlying PDF/DOCX is the artifact. */}
            {resumeFileName && (
              <p
                className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700"
                data-testid="resume-attached-badge"
              >
                <Paperclip aria-hidden="true" size={12} />
                Resume attached: {resumeFileName}
              </p>
            )}
          </div>
          <button
            className="inline-flex min-h-9 items-center justify-center rounded-md border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
            type="button"
            onClick={() =>
              onSavePackage(applicationPackage.id, {
                resumeMarkdown: resumeDraft,
                coverLetter: coverLetterDraft
              })
            }
          >
            Save package drafts
          </button>
        </div>
        <div className="mt-4 grid gap-4 xl:grid-cols-2">
          <textarea
            className="min-h-[420px] w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm leading-6 text-slate-900"
            value={resumeDraft}
            onChange={(event) => setResumeDraft(event.target.value)}
          />
          <DraftPreview text={resumeDraft} />
        </div>
      </section>

      {/*
        Cover letter is opt-in. Most postings don't require one and
        an unwanted cover-letter draft is friction. The full editor
        renders only when applicationPackage.coverLetterIncluded ===
        true. Otherwise we show a slim card with a "Generate cover
        letter" button that triggers a regeneration with
        includeCoverLetter: true.
      */}
      {applicationPackage.coverLetterIncluded ? (
        <section className="rounded-lg border border-line bg-white p-5 shadow-soft">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-base font-semibold text-slate-950">
                Cover letter draft
              </h3>
              <p className="mt-1 text-sm text-slate-500">
                Concise role-specific draft with unsupported claims guarded by the
                safety checker.
              </p>
            </div>
            <button
              className="inline-flex min-h-9 items-center justify-center rounded-md border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
              type="button"
              onClick={() =>
                onSavePackage(applicationPackage.id, {
                  resumeMarkdown: resumeDraft,
                  coverLetter: coverLetterDraft
                })
              }
            >
              Save package drafts
            </button>
          </div>
          <div className="mt-4 grid gap-4 xl:grid-cols-2">
            <textarea
              className="min-h-72 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm leading-6 text-slate-900"
              value={coverLetterDraft}
              onChange={(event) => setCoverLetterDraft(event.target.value)}
            />
            <DraftPreview text={coverLetterDraft} />
          </div>
        </section>
      ) : (
        <section
          className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-5"
          data-testid="cover-letter-optional-card"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-base font-semibold text-slate-950">
                Cover letter (optional)
              </h3>
              <p className="mt-1 text-sm text-slate-600">
                Most jobs don't require a cover letter. Generate one only if the
                posting asks for it.
              </p>
            </div>
            {onGenerateCoverLetter && (
              <button
                className="inline-flex min-h-9 items-center justify-center gap-2 rounded-md bg-ink px-3 text-xs font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-400"
                data-testid="generate-cover-letter"
                type="button"
                disabled={Boolean(isRegeneratingPackage)}
                onClick={() => onGenerateCoverLetter(applicationPackage.id)}
              >
                <Sparkles aria-hidden="true" size={13} />
                {isRegeneratingPackage ? "Generating…" : "Generate cover letter"}
              </button>
            )}
          </div>
        </section>
      )}

      {/*
        Short-answer drafts are opt-in. Greenhouse / Lever public
        APIs don't expose application-form questions, and many jobs
        don't have free-text questions at all. Generating four
        generic answers per package wastes LLM tokens. The user
        opts in via the "Generate short-answer drafts" button when
        the actual application form does ask questions; saved-
        library entries are reused first so the user only writes
        each answer once across applications.
      */}
      {applicationPackage.shortAnswersIncluded ? (
        <section className="rounded-lg border border-line bg-white p-5 shadow-soft">
          <h3 className="text-base font-semibold text-slate-950">
            Short-answer drafts
          </h3>
          <p className="mt-1 text-sm text-slate-500">
            Answers are editable and low-confidence answers stay marked for
            review. Saved answers carry over to your next application
            automatically.
          </p>
          <div className="mt-4 space-y-3">
            {answers.map((answer) => (
              <AnswerEditor
                key={answer.id}
                answer={answer}
                onSaveAnswer={onSaveAnswer}
              />
            ))}
          </div>
        </section>
      ) : (
        <section
          className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-5"
          data-testid="short-answers-optional-card"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-base font-semibold text-slate-950">
                Short-answer drafts (optional)
              </h3>
              <p className="mt-1 text-sm text-slate-600">
                Generate drafts only if the actual application form asks
                free-text questions. Previously-saved answers from your
                personal library are reused automatically.
              </p>
            </div>
            {onGenerateShortAnswers && (
              <button
                className="inline-flex min-h-9 items-center justify-center gap-2 rounded-md bg-ink px-3 text-xs font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-400"
                data-testid="generate-short-answers"
                type="button"
                disabled={Boolean(isRegeneratingPackage)}
                onClick={() => onGenerateShortAnswers(applicationPackage.id)}
              >
                <Sparkles aria-hidden="true" size={13} />
                {isRegeneratingPackage
                  ? "Generating…"
                  : "Generate short-answer drafts"}
              </button>
            )}
          </div>
        </section>
      )}

      {/*
        Company intelligence + risk signals + recruiter leads only
        render when there's something to show (non-empty intel, real
        risk signals, real leads, or an in-flight generation). The
        empty-state "No intelligence has been generated for this job
        yet…" panel was visual noise — surfacing the Generate button
        behind a single disclosure keeps the candidate's primary
        flow uncluttered.
      */}
      {intelligence ||
      riskSignals.length > 0 ||
      recruiterLeads.length > 0 ||
      isGeneratingIntelligence ? (
        <IntelligenceCard
          intelligence={intelligence}
          riskSignals={riskSignals}
          recruiterLeads={recruiterLeads}
          isGenerating={isGeneratingIntelligence}
          onGenerate={onGenerateIntelligence}
          onRefresh={onGenerateIntelligence}
          onMarkHelpful={onMarkIntelligenceHelpful}
          onMarkNotHelpful={onMarkIntelligenceNotHelpful}
          onDismissRiskSignal={onDismissRiskSignal}
        />
      ) : (
        <details className="rounded-lg border border-line bg-white shadow-soft" data-testid="package-intelligence-collapsed">
          <summary className="cursor-pointer list-none p-4 text-xs font-semibold uppercase tracking-wide text-slate-500 hover:bg-slate-50">
            Company intelligence, risk signals, recruiter leads ▾
          </summary>
          <div className="border-t border-slate-100 p-4">
            <IntelligenceCard
              intelligence={intelligence}
              riskSignals={riskSignals}
              recruiterLeads={recruiterLeads}
              isGenerating={isGeneratingIntelligence}
              onGenerate={onGenerateIntelligence}
              onRefresh={onGenerateIntelligence}
              onMarkHelpful={onMarkIntelligenceHelpful}
              onMarkNotHelpful={onMarkIntelligenceNotHelpful}
              onDismissRiskSignal={onDismissRiskSignal}
            />
          </div>
        </details>
      )}
    </div>
  );
}
