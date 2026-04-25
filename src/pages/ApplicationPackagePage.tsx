import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  ShieldCheck,
  XCircle
} from "lucide-react";
import { useEffect, useState } from "react";
import { EmptyState } from "../components/EmptyState";
import type {
  ApplicationAnswer,
  ApplicationPackage,
  ApplicationRecord,
  JobMatch,
  NormalizedJob
} from "../models/domain";

interface ApplicationPackagePageProps {
  applicationPackage: ApplicationPackage | null;
  answers: ApplicationAnswer[];
  application: ApplicationRecord | null;
  job: NormalizedJob | null;
  match: JobMatch | null;
  onBack: () => void;
  onSavePackage: (
    packageId: string,
    updates: { resumeMarkdown: string; coverLetter: string }
  ) => void;
  onSaveAnswer: (answerId: string, answer: string) => void;
  onApprove: (packageId: string) => void;
  onReject: (packageId: string) => void;
}

function statusLabel(value: string): string {
  return value.replace(/_/g, " ");
}

function userFacingJobCopy(value: string): string {
  return value
    .split("Manual import queued for normalization")
    .join("Manually imported job");
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
            <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold capitalize text-slate-700">
              {statusLabel(answer.source)}
            </span>
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
  onBack,
  onSavePackage,
  onSaveAnswer,
  onApprove,
  onReject
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
    <div className="space-y-6">
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
            type="button"
            disabled={!canApprove}
            onClick={() => onApprove(applicationPackage.id)}
          >
            <CheckCircle2 aria-hidden="true" size={17} />
            Approve
          </button>
        </div>
      </header>

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
      ) : (
        <section className="flex gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm leading-6 text-emerald-800">
          <ShieldCheck aria-hidden="true" className="mt-0.5 shrink-0" size={18} />
          <p>No unsupported-claim warnings are currently detected.</p>
        </section>
      )}

      <section className="grid gap-4 xl:grid-cols-3">
        <div className="rounded-lg border border-line bg-white p-4 shadow-soft">
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
        <div className="rounded-lg border border-line bg-white p-4 shadow-soft">
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
        <div className="rounded-lg border border-line bg-white p-4 shadow-soft">
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
      </section>

      <section className="rounded-lg border border-line bg-white p-5 shadow-soft">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-base font-semibold text-slate-950">
              Resume draft
            </h3>
            <p className="mt-1 text-sm text-slate-500">
              Tailored from verified profile facts, parsed resume evidence, and the
              job description.
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
            className="min-h-[420px] w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm leading-6 text-slate-900"
            value={resumeDraft}
            onChange={(event) => setResumeDraft(event.target.value)}
          />
          <DraftPreview text={resumeDraft} />
        </div>
      </section>

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

      <section className="rounded-lg border border-line bg-white p-5 shadow-soft">
        <h3 className="text-base font-semibold text-slate-950">
          Short-answer drafts
        </h3>
        <p className="mt-1 text-sm text-slate-500">
          Answers are editable and low-confidence answers stay marked for review.
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
    </div>
  );
}
