import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  ClipboardCheck,
  FileWarning,
  Plug,
  Send,
  ShieldAlert
} from "lucide-react";
import { EmptyState } from "../components/EmptyState";
import type {
  ApplicationPackage,
  ApplicationRecord,
  BrowserApplicationSession,
  BrowserApplicationSessionStatus,
  ExtensionSession,
  ExtensionSessionStatus,
  JobMatch,
  NormalizedJob
} from "../models/domain";
import { isExtensionSubmitAllowed } from "../services/extensionService";

interface BrowserSessionReviewPageProps {
  browserSession: BrowserApplicationSession | null;
  applicationPackage: ApplicationPackage | null;
  application: ApplicationRecord | null;
  job: NormalizedJob | null;
  match: JobMatch | null;
  extensionSession: ExtensionSession | null;
  onBack: () => void;
  onMarkReadyForReview: (sessionId: string) => void;
  onApproveSubmit: (sessionId: string) => void;
  onSubmitApproved: (sessionId: string) => void;
  onManualRequired: (sessionId: string) => void;
  onConnectExtensionDemo: (browserSessionId: string) => void;
  onApproveExtensionFill: (extensionSessionId: string) => void;
  onSimulateExtensionFill: (extensionSessionId: string) => void;
  onApproveExtensionSubmit: (extensionSessionId: string) => void;
  onSimulateExtensionSubmitComplete: (extensionSessionId: string) => void;
  onDisconnectExtension: (extensionSessionId: string) => void;
  onExtensionManualRequired: (extensionSessionId: string) => void;
}

function extensionStatusTone(status: ExtensionSessionStatus): string {
  if (status === "submitted" || status === "submit_approved") {
    return "bg-emerald-50 text-emerald-700";
  }
  if (
    status === "manual_required" ||
    status === "awaiting_user_authorization"
  ) {
    return "bg-amber-50 text-amber-700";
  }
  if (status === "failed" || status === "disconnected") {
    return "bg-red-50 text-red-700";
  }
  return "bg-slate-100 text-slate-700";
}

function extensionStatusMessage(status: ExtensionSessionStatus): string {
  switch (status) {
    case "extension_not_connected":
      return "No extension session is connected for this application.";
    case "awaiting_user_authorization":
      return "Extension is waiting for explicit authorization to inspect the page.";
    case "connected":
      return "Extension is connected and authorized; waiting for page structure.";
    case "page_analyzed":
      return "Page structure ingested. Generating a safe fill plan.";
    case "fill_plan_ready":
      return "A safe fill plan is ready for your approval.";
    case "fill_approved":
      return "Fill is approved. The extension will fill safe fields next.";
    case "fields_filled":
      return "Fields filled. Move to the final review when ready.";
    case "ready_for_final_review":
      return "Final review. Approve submit only after you review every field on the page.";
    case "submit_approved":
      return "Submit approved. The extension will report submission status when complete.";
    case "submitted":
      return "Submission was confirmed by the extension.";
    case "manual_required":
      return "Manual completion required. CAPTCHA, login, or sensitive field is in the way.";
    case "disconnected":
      return "Extension session has been disconnected.";
    case "failed":
      return "Extension session failed and needs manual review.";
    default:
      return "";
  }
}

function statusLabel(value: string): string {
  return value.replace(/_/g, " ");
}

function statusTone(status: BrowserApplicationSessionStatus): string {
  if (status === "submitted" || status === "approved_for_submit") {
    return "bg-emerald-50 text-emerald-700";
  }

  if (status === "needs_user_input" || status === "manual_required") {
    return "bg-amber-50 text-amber-700";
  }

  if (status === "failed") {
    return "bg-red-50 text-red-700";
  }

  return "bg-slate-100 text-slate-700";
}

function statusMessage(status: BrowserApplicationSessionStatus): string {
  switch (status) {
    case "needs_user_input":
      return "Review the pause items before the assistant can prepare a submit review.";
    case "ready_for_review":
      return "Review the filled fields. Submit approval is available only from this state.";
    case "approved_for_submit":
      return "You approved submit. The assistant can now perform the submit action.";
    case "submitted":
      return "Submission was confirmed and the tracker was updated.";
    case "manual_required":
      return "Automation is paused. Complete this application manually or restart later.";
    case "failed":
      return "The browser session failed and needs manual review.";
    default:
      return "The assistant is preparing the application session.";
  }
}

export function BrowserSessionReviewPage({
  browserSession,
  applicationPackage,
  application,
  job,
  match,
  extensionSession,
  onBack,
  onMarkReadyForReview,
  onApproveSubmit,
  onSubmitApproved,
  onManualRequired,
  onConnectExtensionDemo,
  onApproveExtensionFill,
  onSimulateExtensionFill,
  onApproveExtensionSubmit,
  onSimulateExtensionSubmitComplete,
  onDisconnectExtension,
  onExtensionManualRequired
}: BrowserSessionReviewPageProps) {
  if (!browserSession || !applicationPackage || !job) {
    return (
      <EmptyState
        icon={Bot}
        title="Browser session not found"
        message="Start browser apply from an approved application package to create a reviewable session."
        actionLabel="Back to tracker"
        onAction={onBack}
      />
    );
  }

  const canMarkReady =
    browserSession.status === "needs_user_input" ||
    browserSession.status === "filling";
  const canApproveSubmit = browserSession.status === "ready_for_review";
  const canSubmit = browserSession.status === "approved_for_submit";
  const canManualFallback = !["submitted", "manual_required"].includes(
    browserSession.status
  );

  return (
    <div className="space-y-6" data-testid="browser-session-page">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-3xl">
          <p className="text-sm font-semibold uppercase tracking-wide text-emerald-700">
            Browser Assistant
          </p>
          <h2 className="mt-2 text-3xl font-semibold text-slate-950">
            {job.title} at {job.company}
          </h2>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            {statusMessage(browserSession.status)} The assistant never submits
            without explicit approval from the job seeker.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <span
              className={`rounded-md px-2 py-1 text-xs font-semibold capitalize ${statusTone(browserSession.status)}`}
            >
              Session {statusLabel(browserSession.status)}
            </span>
            <span className="rounded-md bg-purple-50 px-2 py-1 text-xs font-semibold capitalize text-purple-700">
              Package {statusLabel(applicationPackage.status)}
            </span>
            <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold capitalize text-slate-700">
              ATS {browserSession.atsType}
            </span>
            <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold capitalize text-slate-700">
              Adapter {browserSession.atsType}
            </span>
            <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">
              Confidence {Math.round(browserSession.adapterConfidence * 100)}%
            </span>
            <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold capitalize text-slate-700">
              Mode {statusLabel(browserSession.fillMode)}
            </span>
            {application && (
              <span className="rounded-md bg-blue-50 px-2 py-1 text-xs font-semibold capitalize text-blue-700">
                Tracker {statusLabel(application.status)}
              </span>
            )}
            {match && (
              <span className="rounded-md bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700">
                {match.overallScore.toFixed(1)} / 10 match
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
          {canMarkReady && (
            <button
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              type="button"
              onClick={() => onMarkReadyForReview(browserSession.id)}
            >
              <ClipboardCheck aria-hidden="true" size={17} />
              I reviewed pause items
            </button>
          )}
          {canApproveSubmit && (
            <button
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-ink px-3 text-sm font-semibold text-white transition hover:bg-slate-700"
              type="button"
              onClick={() => onApproveSubmit(browserSession.id)}
            >
              <CheckCircle2 aria-hidden="true" size={17} />
              Approve submit
            </button>
          )}
          {canSubmit && (
            <button
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-emerald-700 px-3 text-sm font-semibold text-white transition hover:bg-emerald-800"
              type="button"
              onClick={() => onSubmitApproved(browserSession.id)}
            >
              <Send aria-hidden="true" size={17} />
              Submit with assistant
            </button>
          )}
          {canManualFallback && (
            <button
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 text-sm font-semibold text-amber-800 transition hover:bg-amber-100"
              type="button"
              onClick={() => onManualRequired(browserSession.id)}
            >
              <FileWarning aria-hidden="true" size={17} />
              Manual apply needed
            </button>
          )}
        </div>
      </header>

      <section className="rounded-lg border border-amber-200 bg-amber-50 p-4">
        <div className="flex gap-3">
          <ShieldAlert
            aria-hidden="true"
            className="mt-0.5 shrink-0 text-amber-800"
            size={18}
          />
          <div>
            <h3 className="text-sm font-semibold text-amber-950">
              Human approval gate
            </h3>
            <p className="mt-1 text-sm leading-6 text-amber-900">
              CAPTCHA, login challenges, sensitive questions, and the final submit
              screen always require human control. The assistant stores field
              provenance and redacted previews, not private answer text.
            </p>
            {!canSubmit && (
              <p
                className="mt-2 text-sm font-semibold text-amber-950"
                data-testid="submit-blocked-message"
              >
                Submit is blocked until this same session has explicit user
                approval and reaches approved-for-submit status.
              </p>
            )}
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-lg border border-line bg-white p-4 shadow-soft">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Adapter confidence
          </p>
          <p className="mt-2 text-3xl font-semibold text-slate-950">
            {Math.round(browserSession.adapterConfidence * 100)}%
          </p>
        </div>
        <div className="rounded-lg border border-line bg-white p-4 shadow-soft">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Fields detected
          </p>
          <p className="mt-2 text-3xl font-semibold text-slate-950">
            {browserSession.fieldsDetected.length}
          </p>
        </div>
        <div className="rounded-lg border border-line bg-white p-4 shadow-soft">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Fields filled
          </p>
          <p className="mt-2 text-3xl font-semibold text-slate-950">
            {browserSession.fieldsFilled.length}
          </p>
        </div>
        <div className="rounded-lg border border-line bg-white p-4 shadow-soft">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Pause items
          </p>
          <p className="mt-2 text-3xl font-semibold text-slate-950">
            {browserSession.uncertainFields.length}
          </p>
        </div>
      </section>

      <section className="rounded-lg border border-line bg-white p-5 shadow-soft">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h3 className="text-base font-semibold text-slate-950">
              Fill plan preview
            </h3>
            <p className="mt-1 text-sm leading-6 text-slate-600">
              Mode is {statusLabel(browserSession.fillMode)}. This preview shows
              what the adapter can fill safely and what still needs user input.
            </p>
          </div>
          <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold capitalize text-slate-700">
            {browserSession.adapterName}
          </span>
        </div>
        <div className="mt-4 space-y-3">
          {browserSession.fillPlan.length === 0 ? (
            <p className="text-sm text-slate-500">
              No fill plan was generated for this session.
            </p>
          ) : (
            browserSession.fillPlan.map((item) => (
              <div
                key={`${item.fieldId}-${item.action}`}
                className="rounded-md border border-slate-200 bg-panel p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-slate-900">
                    {item.label}
                  </p>
                  <span className="rounded-md bg-white px-2 py-1 text-xs font-semibold capitalize text-slate-700">
                    {statusLabel(item.action)}
                  </span>
                </div>
                <p className="mt-1 text-sm leading-6 text-slate-600">
                  {item.valuePreview}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Source: {statusLabel(item.source)} · Confidence{" "}
                  {Math.round(item.confidence * 100)}%
                </p>
                {item.reason && (
                  <p className="mt-2 text-xs leading-5 text-amber-800">
                    {item.reason}
                  </p>
                )}
              </div>
            ))
          )}
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[1fr_1fr]">
        <div className="rounded-lg border border-line bg-white p-5 shadow-soft">
          <h3 className="text-base font-semibold text-slate-950">
            Detected form fields
          </h3>
          <div className="mt-4 space-y-3">
            {browserSession.fieldsDetected.map((field) => (
              <div
                key={field.id}
                className="rounded-md border border-slate-200 bg-panel p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-slate-900">
                    {field.label}
                  </p>
                  <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold capitalize text-slate-700">
                    {field.fieldType}
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  Source: {statusLabel(field.source)} · Confidence{" "}
                  {Math.round(field.confidence * 100)}%
                </p>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-5">
          <section className="rounded-lg border border-line bg-white p-5 shadow-soft">
            <h3 className="text-base font-semibold text-slate-950">
              {browserSession.fillMode === "dry_run"
                ? "Fields that will be filled"
                : "Filled fields"}
            </h3>
            <div className="mt-4 space-y-3">
              {browserSession.fieldsFilled.length === 0 ? (
                <p className="text-sm text-slate-500">
                  No safe fields were filled in this run.
                </p>
              ) : (
                browserSession.fieldsFilled.map((field) => (
                  <div
                    key={field.fieldId}
                    className="rounded-md border border-emerald-200 bg-emerald-50 p-3"
                  >
                    <p className="text-sm font-semibold text-emerald-950">
                      {field.label}
                    </p>
                    <p className="mt-1 text-sm leading-6 text-emerald-800">
                      {field.valuePreview}
                    </p>
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="rounded-lg border border-line bg-white p-5 shadow-soft">
            <h3 className="text-base font-semibold text-slate-950">
              Pause items
            </h3>
            <div className="mt-4 space-y-3">
              {browserSession.uncertainFields.length === 0 ? (
                <p className="text-sm text-slate-500">
                  No pause items were detected before submit review.
                </p>
              ) : (
                browserSession.uncertainFields.map((field) => (
                  <div
                    key={`${field.fieldId}-${field.reason}`}
                    className="rounded-md border border-amber-200 bg-amber-50 p-3"
                  >
                    <div className="flex items-start gap-2">
                      <AlertTriangle
                        aria-hidden="true"
                        className="mt-0.5 shrink-0 text-amber-800"
                        size={16}
                      />
                      <div>
                        <p className="text-sm font-semibold text-amber-950">
                          {field.label}
                        </p>
                        <p className="mt-1 text-sm leading-6 text-amber-900">
                          {field.guidance}
                        </p>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>
      </section>

      <section className="rounded-lg border border-line bg-white p-5 shadow-soft">
        <h3 className="text-base font-semibold text-slate-950">
          Browser screenshot
        </h3>
        {browserSession.screenshotUrl ? (
          <img
            alt="Browser session screenshot"
            className="mt-4 rounded-md border border-slate-200"
            src={browserSession.screenshotUrl}
          />
        ) : (
          <div className="mt-4 flex min-h-48 items-center justify-center rounded-md border border-dashed border-slate-300 bg-panel p-6 text-center text-sm leading-6 text-slate-500">
            Screenshot preview will appear here when a real browser adapter is
            connected.
          </div>
        )}
      </section>

      <ExtensionPanel
        browserSessionId={browserSession.id}
        extensionSession={extensionSession}
        applicationPackage={applicationPackage}
        onConnectExtensionDemo={onConnectExtensionDemo}
        onApproveExtensionFill={onApproveExtensionFill}
        onSimulateExtensionFill={onSimulateExtensionFill}
        onApproveExtensionSubmit={onApproveExtensionSubmit}
        onSimulateExtensionSubmitComplete={onSimulateExtensionSubmitComplete}
        onDisconnectExtension={onDisconnectExtension}
        onExtensionManualRequired={onExtensionManualRequired}
      />
    </div>
  );
}

interface ExtensionPanelProps {
  browserSessionId: string;
  extensionSession: ExtensionSession | null;
  applicationPackage: ApplicationPackage | null;
  onConnectExtensionDemo: (browserSessionId: string) => void;
  onApproveExtensionFill: (extensionSessionId: string) => void;
  onSimulateExtensionFill: (extensionSessionId: string) => void;
  onApproveExtensionSubmit: (extensionSessionId: string) => void;
  onSimulateExtensionSubmitComplete: (extensionSessionId: string) => void;
  onDisconnectExtension: (extensionSessionId: string) => void;
  onExtensionManualRequired: (extensionSessionId: string) => void;
}

function ExtensionPanel({
  browserSessionId,
  extensionSession,
  applicationPackage,
  onConnectExtensionDemo,
  onApproveExtensionFill,
  onSimulateExtensionFill,
  onApproveExtensionSubmit,
  onSimulateExtensionSubmitComplete,
  onDisconnectExtension,
  onExtensionManualRequired
}: ExtensionPanelProps) {
  if (!extensionSession) {
    return (
      <section className="rounded-lg border border-line bg-white p-5 shadow-soft">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h3 className="text-base font-semibold text-slate-950">
              Extension session
            </h3>
            <p className="mt-1 text-sm leading-6 text-slate-600">
              No extension is connected for this browser session. The local
              extension is opt-in and never inspects pages without your
              authorization.
            </p>
          </div>
          <button
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-emerald-700 bg-white px-3 text-sm font-semibold text-emerald-700 transition hover:bg-emerald-50"
            type="button"
            onClick={() => onConnectExtensionDemo(browserSessionId)}
          >
            <Plug aria-hidden="true" size={17} />
            Connect demo extension
          </button>
        </div>
      </section>
    );
  }

  const submitAllowed = isExtensionSubmitAllowed(
    extensionSession,
    applicationPackage
  );
  const canApproveFill = extensionSession.status === "fill_plan_ready";
  const canSimulateFill = extensionSession.status === "fill_approved";
  const canApproveSubmit = extensionSession.status === "ready_for_final_review";
  const canSimulateComplete = submitAllowed;
  const canDisconnect =
    extensionSession.status !== "submitted" &&
    extensionSession.status !== "disconnected";
  const canManualFallback =
    extensionSession.status !== "submitted" &&
    extensionSession.status !== "manual_required" &&
    extensionSession.status !== "disconnected";

  return (
    <section className="rounded-lg border border-line bg-white p-5 shadow-soft">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-2xl">
          <h3 className="text-base font-semibold text-slate-950">
            Extension session
          </h3>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            {extensionStatusMessage(extensionSession.status)}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <span
              className={`rounded-md px-2 py-1 text-xs font-semibold capitalize ${extensionStatusTone(extensionSession.status)}`}
            >
              {statusLabel(extensionSession.status)}
            </span>
            <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">
              {extensionSession.fieldsDetected.length} fields detected
            </span>
            <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">
              {extensionSession.fieldsFilled.length} filled
            </span>
            <span className="rounded-md bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-700">
              {extensionSession.uncertainFields.length} pause items
            </span>
          </div>
          <div className="mt-3 space-y-1 text-xs text-slate-600">
            <p>
              <strong>Page:</strong> {extensionSession.pageTitle || "(untitled)"} —{" "}
              <span className="break-all">{extensionSession.pageUrl}</span>
            </p>
            <p>
              <strong>Hostname:</strong> {extensionSession.hostname || "(unknown)"}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {canApproveFill && (
            <button
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-ink px-3 text-sm font-semibold text-white transition hover:bg-slate-700"
              type="button"
              onClick={() => onApproveExtensionFill(extensionSession.id)}
            >
              <CheckCircle2 aria-hidden="true" size={17} />
              Approve fill
            </button>
          )}
          {canSimulateFill && (
            <button
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              type="button"
              onClick={() => onSimulateExtensionFill(extensionSession.id)}
            >
              <ClipboardCheck aria-hidden="true" size={17} />
              Simulate extension fill
            </button>
          )}
          {canApproveSubmit && (
            <button
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-ink px-3 text-sm font-semibold text-white transition hover:bg-slate-700"
              type="button"
              onClick={() => onApproveExtensionSubmit(extensionSession.id)}
            >
              <CheckCircle2 aria-hidden="true" size={17} />
              Approve extension submit
            </button>
          )}
          <button
            className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-md px-3 text-sm font-semibold transition ${
              canSimulateComplete
                ? "bg-emerald-700 text-white hover:bg-emerald-800"
                : "cursor-not-allowed border border-slate-200 bg-slate-100 text-slate-400"
            }`}
            type="button"
            disabled={!canSimulateComplete}
            onClick={() => onSimulateExtensionSubmitComplete(extensionSession.id)}
          >
            <Send aria-hidden="true" size={17} />
            {canSimulateComplete
              ? "Confirm extension submit"
              : "Submit blocked until approved"}
          </button>
          {canManualFallback && (
            <button
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 text-sm font-semibold text-amber-800 transition hover:bg-amber-100"
              type="button"
              onClick={() => onExtensionManualRequired(extensionSession.id)}
            >
              <FileWarning aria-hidden="true" size={17} />
              Manual apply
            </button>
          )}
          {canDisconnect && (
            <button
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              type="button"
              onClick={() => onDisconnectExtension(extensionSession.id)}
            >
              <Plug aria-hidden="true" size={17} />
              Disconnect
            </button>
          )}
        </div>
      </div>

      {extensionSession.fillPlan.length > 0 && (
        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          <div>
            <h4 className="text-sm font-semibold text-slate-950">
              Extension fill plan
            </h4>
            <div className="mt-2 space-y-2">
              {extensionSession.fillPlan.map((item) => (
                <div
                  key={`${item.fieldId}-${item.action}`}
                  className="rounded-md border border-slate-200 bg-panel p-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-slate-900">
                      {item.label}
                    </p>
                    <span className="rounded-md bg-white px-2 py-1 text-xs font-semibold capitalize text-slate-700">
                      {statusLabel(item.action)}
                    </span>
                  </div>
                  <p className="mt-1 text-sm leading-6 text-slate-600">
                    {item.valuePreview || "No safe value available"}
                  </p>
                  {item.reason && (
                    <p className="mt-1 text-xs leading-5 text-amber-800">
                      {item.reason}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div>
            <h4 className="text-sm font-semibold text-slate-950">
              Pause items
            </h4>
            {extensionSession.uncertainFields.length === 0 ? (
              <p className="mt-2 text-sm text-slate-500">
                No pause items detected on this page.
              </p>
            ) : (
              <div className="mt-2 space-y-2">
                {extensionSession.uncertainFields.map((field) => (
                  <div
                    key={`${field.fieldId}-${field.reason}`}
                    className="rounded-md border border-amber-200 bg-amber-50 p-3"
                  >
                    <div className="flex items-start gap-2">
                      <AlertTriangle
                        aria-hidden="true"
                        className="mt-0.5 shrink-0 text-amber-800"
                        size={16}
                      />
                      <div>
                        <p className="text-sm font-semibold text-amber-950">
                          {field.label}
                        </p>
                        <p className="mt-1 text-sm leading-6 text-amber-900">
                          {field.guidance}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
