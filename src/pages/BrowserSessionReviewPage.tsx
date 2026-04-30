import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  ClipboardCheck,
  Copy,
  ExternalLink,
  FileWarning,
  Paperclip,
  Plug,
  RefreshCw,
  Send,
  ShieldAlert
} from "lucide-react";
import { useState } from "react";
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
import type { ManualApplyHelperData } from "../services/manualApplyHelper";

/**
 * Browser-extension primary path — replaces the v1 bookmarklet UX.
 *
 * `extensionStatus` is supplied by App.tsx via the
 * browserExtensionBridge service. When the bridge has heard from
 * the dashboardBridge content script we know the extension is
 * installed and show the "Sync to extension" button; otherwise we
 * show the install CTA. After a successful sync the candidate
 * opens the application page (Greenhouse / Lever) and the pill
 * content script fills every input there — same UX as
 * Simplify.jobs but adapted to our hard rules (no auto-submit).
 */
interface ExtensionStatusForCard {
  available: boolean;
  version: string | null;
  lastSyncedAt: string | null;
}

interface BrowserSessionReviewPageProps {
  browserSession: BrowserApplicationSession | null;
  applicationPackage: ApplicationPackage | null;
  application: ApplicationRecord | null;
  job: NormalizedJob | null;
  match: JobMatch | null;
  extensionSession: ExtensionSession | null;
  /**
   * Computed by App.tsx via `buildManualApplyHelper`. Renders a
   * copyable summary the user can paste into the actual application
   * form when they choose manual apply (or when the dry-run
   * assistant can't drive the page itself).
   */
  manualApplyHelper: ManualApplyHelperData | null;
  /**
   * Live status of the Agentic browser extension. Drives whether the
   * card shows the install CTA or the "Sync to extension" button.
   * Comes from `subscribeExtensionBridgeStatus` in App.tsx.
   */
  extensionStatus: ExtensionStatusForCard;
  /**
   * Push the candidate's profile + active package + answers + job to
   * the extension via window.postMessage. Resolves with a syncedAt
   * timestamp on bridge ack, rejects on timeout.
   */
  onSyncToExtension?: () => Promise<{ syncedAt: string }>;
  /**
   * Pull captured saved-answer entries from the extension's
   * chrome.storage and merge them into the local
   * SavedApplicationAnswer library. Surfaced as a "Pull saved
   * answers from extension" button.
   */
  onPullSavedAnswers?: () => Promise<{ mergedCount: number }>;
  /**
   * True when the persisted package was generated against the URL-
   * import placeholder ("Imported job pending enrichment") but the
   * underlying job has since been enriched. Driven by
   * `isPackageStaleAfterJobEnrichment` from applicationPackage.ts.
   */
  isStaleAfterJobEnrichment?: boolean;
  /** True while a regenerate / enrichment retry is in flight. */
  isRegeneratingPackage?: boolean;
  /** True when the underlying job is still a URL-import placeholder. */
  isJobPendingEnrichment?: boolean;
  /** Trigger a fresh enrichment fetch for the underlying job. */
  onRetryJobEnrichment?: () => void;
  /** Trigger regeneration of the package against the current job/profile. */
  onRegeneratePackage?: () => void;
  /**
   * Navigate to the Profile setup page so the user can fill the
   * commonly-required field that's currently empty (LinkedIn,
   * Work Authorization, etc.). When undefined the "Add to profile"
   * CTA is not rendered.
   */
  onOpenProfileSetup?: () => void;
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
  manualApplyHelper,
  extensionStatus,
  onSyncToExtension,
  onPullSavedAnswers,
  isStaleAfterJobEnrichment,
  isRegeneratingPackage,
  isJobPendingEnrichment,
  onRetryJobEnrichment,
  onRegeneratePackage,
  onOpenProfileSetup,
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

      {/*
        Job-pending-enrichment banner. The URL importer creates a
        placeholder job synchronously; enrichment runs in the
        background. If enrichment failed (404 / network) the job
        stays as the placeholder forever — and every downstream
        artifact (package, browser session) inherits the bad title
        + missing description. Surface that here with a Retry button
        so the user can recover without re-pasting the URL.
      */}
      {isJobPendingEnrichment && (
        <section
          className="rounded-lg border border-amber-300 bg-amber-50 p-4"
          data-testid="browser-session-job-pending-enrichment-banner"
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
                  Job details are still placeholder values
                </h3>
                <p className="mt-1 text-sm leading-6 text-amber-800">
                  The original URL enrichment didn't complete. Without it,
                  fields below are tailored to "Imported job pending enrichment"
                  rather than the real role. Refresh now to fetch the live
                  Greenhouse / Lever data.
                </p>
              </div>
            </div>
            {onRetryJobEnrichment && (
              <button
                className="inline-flex min-h-9 shrink-0 items-center justify-center gap-2 rounded-md bg-amber-700 px-3 text-xs font-semibold text-white transition hover:bg-amber-800 disabled:cursor-not-allowed disabled:bg-amber-400"
                data-testid="browser-session-retry-job-enrichment"
                type="button"
                disabled={Boolean(isRegeneratingPackage)}
                onClick={onRetryJobEnrichment}
              >
                <RefreshCw aria-hidden="true" size={13} />
                {isRegeneratingPackage ? "Refreshing…" : "Refresh job details"}
              </button>
            )}
          </div>
        </section>
      )}

      {isStaleAfterJobEnrichment && !isJobPendingEnrichment && (
        <section
          className="rounded-lg border border-amber-300 bg-amber-50 p-4"
          data-testid="browser-session-stale-banner"
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
                  Package was generated against the old placeholder
                </h3>
                <p className="mt-1 text-sm leading-6 text-amber-800">
                  The job has been enriched since this package was prepared.
                  Regenerate so the resume + cover letter + answers reference
                  the real title and description.
                </p>
              </div>
            </div>
            {onRegeneratePackage && (
              <button
                className="inline-flex min-h-9 shrink-0 items-center justify-center gap-2 rounded-md bg-amber-700 px-3 text-xs font-semibold text-white transition hover:bg-amber-800 disabled:cursor-not-allowed disabled:bg-amber-400"
                data-testid="browser-session-regenerate-package"
                type="button"
                disabled={Boolean(isRegeneratingPackage)}
                onClick={onRegeneratePackage}
              >
                <RefreshCw aria-hidden="true" size={13} />
                {isRegeneratingPackage ? "Regenerating…" : "Regenerate package"}
              </button>
            )}
          </div>
        </section>
      )}

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

      {/*
        Manual-apply helper. The dry-run assistant computes everything
        we'd need to drive the form (field labels, values, cover
        letter, answers) but can't actually drive a real browser. So
        instead we surface a copy-friendly card the user takes to the
        actual application page. Big "Open job application" button
        opens the real URL in a new tab; copy buttons next to each
        value let the user paste field-by-field. This makes the
        existing dry-run output useful instead of decorative.
      */}
      {manualApplyHelper && (
        <ManualApplyHelperCard
          data={manualApplyHelper}
          extensionStatus={extensionStatus}
          onSyncToExtension={onSyncToExtension}
          onPullSavedAnswers={onPullSavedAnswers}
          onMarkApplied={() => onManualRequired(browserSession.id)}
          onOpenProfileSetup={onOpenProfileSetup}
        />
      )}

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

/**
 * Browser-extension panel — Simplify-style primary path.
 *
 * Replaces the v1 bookmarklet (deprecated as of v0.2 of the
 * extension). When the dashboardBridge content script has reported
 * in via window.postMessage, we know the extension is installed and
 * show the "Sync to extension" CTA. Otherwise we render install
 * instructions for the dev-mode load-unpacked flow (Web Store
 * publishing is a future slice).
 *
 * After sync, the candidate opens a Greenhouse / Lever job page
 * and clicks the floating "Apply with Agentic" pill the extension
 * injected — same UX as Simplify Copilot. Hard rules from CLAUDE.md
 * are enforced by the pill content script: no auto-submit, no
 * CAPTCHA bypass, no password / hidden / file fills.
 */
function AgenticExtensionPanel({
  status,
  jobLabel,
  onSync,
  onPullSavedAnswers
}: {
  status: ExtensionStatusForCard;
  jobLabel: string;
  onSync?: () => Promise<{ syncedAt: string }>;
  onPullSavedAnswers?: () => Promise<{ mergedCount: number }>;
}) {
  const [syncing, setSyncing] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [pullMessage, setPullMessage] = useState<string | null>(null);

  const lastSyncedRel =
    status.lastSyncedAt &&
    `${Math.max(
      1,
      Math.round((Date.now() - new Date(status.lastSyncedAt).getTime()) / 1000)
    )}s ago`;

  if (!status.available) {
    return (
      <div
        className="mt-4 rounded-md border border-emerald-300 bg-emerald-50 p-4"
        data-testid="manual-apply-extension-install"
      >
        <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
          One-click form fill via the Agentic browser extension
        </p>
        <p className="mt-1 text-sm leading-6 text-slate-700">
          Install once. Then on every Greenhouse or Lever job page a small
          <strong> Apply with Agentic </strong> pill appears bottom-right —
          click it and every input on the form fills inline from your saved
          profile. We never auto-submit; you review and click Submit yourself.
        </p>
        <ol className="mt-3 list-decimal space-y-1 pl-5 text-xs leading-5 text-slate-700">
          <li>
            Open <code>chrome://extensions/</code>, turn on{" "}
            <strong>Developer mode</strong> (top-right toggle).
          </li>
          <li>
            Click <strong>Load unpacked</strong> and pick the{" "}
            <code>extension/</code> folder from this repo.
          </li>
          <li>
            Refresh this page — this card will flip to "Sync to extension"
            once the bridge is detected.
          </li>
        </ol>
        <p className="mt-3 text-[11px] leading-5 text-slate-600">
          A signed Chrome Web Store build is on the roadmap; load-unpacked is
          the dev path for now.
        </p>
      </div>
    );
  }

  return (
    <div
      className="mt-4 rounded-md border border-emerald-300 bg-emerald-50 p-4"
      data-testid="manual-apply-extension-installed"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
            Extension installed
            {status.version ? ` · v${status.version}` : ""}
          </p>
          <p className="mt-1 text-sm leading-6 text-slate-700">
            Sync your profile + drafts for <strong>{jobLabel}</strong>, then
            open the application page in a new tab. The Agentic pill there
            fills every input. Captures any new answers you type so the next
            form is faster.
          </p>
          {status.lastSyncedAt && (
            <p
              className="mt-1 text-[11px] text-slate-600"
              data-testid="manual-apply-extension-last-synced"
            >
              Last synced {lastSyncedRel}.
            </p>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <button
            type="button"
            className="inline-flex min-h-9 items-center justify-center gap-2 rounded-md bg-emerald-700 px-3 text-xs font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-slate-400"
            data-testid="manual-apply-sync-extension"
            disabled={syncing || !onSync}
            onClick={async () => {
              if (!onSync) return;
              setSyncMessage(null);
              setSyncing(true);
              try {
                const result = await onSync();
                setSyncMessage(`Synced ${new Date(result.syncedAt).toLocaleTimeString()}`);
              } catch (error) {
                setSyncMessage(
                  error instanceof Error ? error.message : "Sync failed"
                );
              } finally {
                setSyncing(false);
              }
            }}
          >
            {syncing ? "Syncing…" : "Sync to extension"}
          </button>
          {onPullSavedAnswers && (
            <button
              type="button"
              className="inline-flex min-h-9 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              data-testid="manual-apply-pull-saved-answers"
              disabled={pulling}
              onClick={async () => {
                setPullMessage(null);
                setPulling(true);
                try {
                  const result = await onPullSavedAnswers();
                  setPullMessage(
                    result.mergedCount === 0
                      ? "No new captures to pull"
                      : `Merged ${result.mergedCount} new answer${result.mergedCount === 1 ? "" : "s"} into your library`
                  );
                } catch (error) {
                  setPullMessage(
                    error instanceof Error ? error.message : "Pull failed"
                  );
                } finally {
                  setPulling(false);
                }
              }}
            >
              {pulling ? "Pulling…" : "Pull saved answers"}
            </button>
          )}
        </div>
      </div>
      {(syncMessage || pullMessage) && (
        <p
          className="mt-3 text-[11px] leading-5 text-slate-700"
          data-testid="manual-apply-extension-status-message"
        >
          {syncMessage}
          {syncMessage && pullMessage ? " · " : null}
          {pullMessage}
        </p>
      )}
      <p className="mt-3 text-[11px] leading-5 text-slate-600">
        How it works: the extension stores synced data in chrome.storage.local
        on your machine — never sent to any server. The pill fills only the
        page you click it from, never auto-submits, and never reads password
        or hidden fields.
      </p>
    </div>
  );
}

/**
 * Per-row copy button. Shows "Copied" feedback for ~1.5s after a
 * successful copy so the user has visual confirmation. Falls back
 * silently if `navigator.clipboard` is unavailable (older browsers,
 * non-secure contexts) — the value is still selectable in the
 * adjacent block so the user can copy manually.
 */
function CopyButton({
  value,
  label,
  variant = "secondary",
  text = "Copy",
  testId = "manual-apply-copy"
}: {
  value: string;
  label: string;
  /** Primary variant (filled emerald) for the prominent "Copy all" button. */
  variant?: "primary" | "secondary";
  text?: string;
  testId?: string;
}) {
  const [copied, setCopied] = useState(false);
  const baseClasses =
    variant === "primary"
      ? "inline-flex min-h-9 shrink-0 items-center justify-center gap-1.5 rounded-md bg-ink px-3 text-xs font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-400"
      : "inline-flex min-h-7 shrink-0 items-center justify-center gap-1 rounded-md border border-slate-300 bg-white px-2 text-[11px] font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50";
  return (
    <button
      type="button"
      className={baseClasses}
      data-testid={testId}
      aria-label={`Copy ${label}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* clipboard unavailable; user can still select + copy */
        }
      }}
    >
      <Copy aria-hidden="true" size={variant === "primary" ? 13 : 11} />
      {copied ? "Copied" : text}
    </button>
  );
}

function ManualApplyHelperCard({
  data,
  extensionStatus,
  onSyncToExtension,
  onPullSavedAnswers,
  onMarkApplied,
  onOpenProfileSetup
}: {
  data: ManualApplyHelperData;
  extensionStatus: ExtensionStatusForCard;
  onSyncToExtension?: () => Promise<{ syncedAt: string }>;
  onPullSavedAnswers?: () => Promise<{ mergedCount: number }>;
  onMarkApplied: () => void;
  onOpenProfileSetup?: () => void;
}) {
  // The extension is the primary path. Copy-paste fallback collapses
  // behind a toggle so users without the extension still have a way
  // to get values onto the form. Default-collapsed when extension is
  // installed AND we've synced; otherwise expanded so first-time
  // users see the full picture immediately.
  const [showCopyPaste, setShowCopyPaste] = useState(
    !extensionStatus.available || !extensionStatus.lastSyncedAt
  );
  return (
    <section
      className="rounded-lg border border-emerald-200 bg-white p-5 shadow-soft"
      data-testid="manual-apply-helper-card"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-base font-semibold text-slate-950">
            Apply now in your browser
          </h3>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            {extensionStatus.available
              ? "Sync your profile to the extension, then open the application page — the Apply with Agentic pill fills every input from your saved data. We never auto-submit; you review and click Submit yourself."
              : "Install the Agentic browser extension to fill applications with one click. Without the extension, use the copy-paste fields below as a fallback. We never auto-submit."}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {data.jobUrl && (
            <a
              className="inline-flex min-h-9 items-center justify-center gap-2 rounded-md bg-emerald-700 px-3 text-xs font-semibold text-white transition hover:bg-emerald-800"
              data-testid="manual-apply-open-job"
              href={data.jobUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              <ExternalLink aria-hidden="true" size={13} />
              Open job application
            </a>
          )}
          <button
            className="inline-flex min-h-9 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
            data-testid="manual-apply-mark-applied"
            type="button"
            onClick={onMarkApplied}
          >
            <CheckCircle2 aria-hidden="true" size={13} />
            Mark as applied
          </button>
        </div>
      </div>

      <AgenticExtensionPanel
        status={extensionStatus}
        jobLabel={data.jobLabel}
        onSync={onSyncToExtension}
        onPullSavedAnswers={onPullSavedAnswers}
      />

      {/* The "show copy-paste fields" toggle wires the variable used
          by every conditional below — it stays meaningful as a manual
          fallback even though the extension is the primary path. */}

      {/*
        Resume-attached badge stays at the card top regardless of
        copy-paste expand state — uploading the resume is something
        the user does on every application path (the bookmarklet
        can't fill <input type="file">).
      */}
      {data.resumeFileName && (
        <p
          className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700"
          data-testid="manual-apply-resume-attached"
        >
          <Paperclip aria-hidden="true" size={12} />
          Upload resume: {data.resumeFileName}
        </p>
      )}

      {/*
        Copy-paste fallback. Hidden by default when a bookmarklet
        is available; one toggle reveals the detailed per-field
        list + Copy all + missing-field CTAs. Bookmarklet covers
        all standard inputs; copy-paste is for: (a) pages where
        the bookmarklet can't find a selector match, (b) custom
        questions the user wants to refine before pasting,
        (c) users who don't want to install a bookmarklet.
      */}
      {extensionStatus.available && !showCopyPaste && (
        <button
          type="button"
          className="mt-4 inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
          data-testid="manual-apply-show-copy-paste"
          onClick={() => setShowCopyPaste(true)}
        >
          Show copy-paste fields (fallback)
        </button>
      )}

      {showCopyPaste && (
        <div className="mt-4 flex items-center justify-between gap-2">
          <p className="text-xs uppercase tracking-wide text-slate-500">
            Copy-paste fields
          </p>
          <div className="flex items-center gap-2">
            <CopyButton
              value={data.copyAllText}
              label="all fields"
              variant="secondary"
              text="Copy all"
              testId="manual-apply-copy-all"
            />
            {extensionStatus.available && (
              <button
                type="button"
                className="text-[11px] font-semibold text-slate-500 underline-offset-2 hover:underline"
                onClick={() => setShowCopyPaste(false)}
              >
                Hide
              </button>
            )}
          </div>
        </div>
      )}

      {showCopyPaste && data.fields.length > 0 && (
        <div className="mt-4 space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Your details
          </p>
          <div className="space-y-2">
            {data.fields.map((field) => (
              <div
                key={`${field.label}-${field.value}`}
                className="flex flex-col gap-2 rounded-md border border-slate-200 bg-panel p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    {field.label}
                  </p>
                  <p className="mt-1 truncate text-sm text-slate-900" title={field.value}>
                    {field.value}
                  </p>
                  <p className="mt-1 text-[11px] text-slate-500">
                    Source: {field.sourceLabel}
                  </p>
                </div>
                <CopyButton value={field.value} label={field.label} />
              </div>
            ))}
          </div>
        </div>
      )}

      {showCopyPaste && data.voluntarySelfIdFields.length > 0 && (
        <div
          className="mt-4 space-y-2"
          data-testid="manual-apply-voluntary-self-id"
        >
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Voluntary self-identification
          </p>
          <p className="text-[11px] leading-5 text-slate-500">
            EEO-1 / Section 503 demographic fields. Filling these on the
            actual form is voluntary; the values below come from your saved
            answers.
          </p>
          <div className="space-y-2">
            {data.voluntarySelfIdFields.map((field) => (
              <div
                key={`vsi-${field.label}`}
                className="flex flex-col gap-2 rounded-md border border-slate-200 bg-panel p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    {field.label}
                  </p>
                  <p className="mt-1 truncate text-sm text-slate-900" title={field.value}>
                    {field.value}
                  </p>
                </div>
                <CopyButton value={field.value} label={field.label} />
              </div>
            ))}
          </div>
        </div>
      )}

      {showCopyPaste && data.missingFields.length > 0 && (
        <div className="mt-4 space-y-2" data-testid="manual-apply-missing-fields">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Likely needed but not in your profile
          </p>
          <div className="space-y-2">
            {data.missingFields.map((missing) => (
              <div
                key={missing.profileField}
                className="flex flex-col gap-2 rounded-md border border-dashed border-amber-300 bg-amber-50 p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold uppercase tracking-wide text-amber-900">
                    {missing.label}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-amber-800">
                    {missing.guidance}
                  </p>
                </div>
                {onOpenProfileSetup && (
                  <button
                    type="button"
                    className="inline-flex min-h-7 shrink-0 items-center justify-center gap-1 rounded-md border border-amber-400 bg-white px-2 text-[11px] font-semibold text-amber-800 transition hover:bg-amber-100"
                    onClick={onOpenProfileSetup}
                  >
                    Add to profile →
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {showCopyPaste && data.coverLetter && (
        <div className="mt-4 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Cover letter
            </p>
            <CopyButton value={data.coverLetter} label="cover letter" />
          </div>
          <div className="max-h-48 overflow-auto rounded-md border border-slate-200 bg-panel p-3">
            <pre className="whitespace-pre-wrap font-sans text-xs leading-5 text-slate-700">
              {data.coverLetter}
            </pre>
          </div>
        </div>
      )}

      {showCopyPaste && data.shortAnswers.length > 0 && (
        <div className="mt-4 space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Short answers
          </p>
          <div className="space-y-3">
            {data.shortAnswers.map((qa) => (
              <div
                key={qa.question}
                className="rounded-md border border-slate-200 bg-panel p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-slate-900">
                    {qa.question}
                  </p>
                  <div className="flex items-center gap-2">
                    {qa.fromLibrary && (
                      <span className="rounded-md bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                        From your saved answers
                      </span>
                    )}
                    <CopyButton value={qa.answer} label={qa.question} />
                  </div>
                </div>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">
                  {qa.answer}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {data.pauseItems.length > 0 && (
        <div className="mt-4 space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            You'll handle these on the page
          </p>
          <ul className="space-y-2">
            {data.pauseItems.map((item) => (
              <li
                key={item.label}
                className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs leading-5"
              >
                <p className="font-semibold text-amber-950">{item.label}</p>
                <p className="mt-1 text-amber-900">{item.reason}</p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/*
        Honest footer about the dry-run limitation. Until a real
        Chrome extension actually reads the live page DOM, the field
        list above is profile-data based — we surface every value
        the user has, but the real form may have additional fields
        (e.g. "How did you hear about us?", visa-sponsorship radio).
        Telling the user this directly builds trust + sets the right
        expectation.
      */}
      <p
        className="mt-4 text-[11px] leading-5 text-slate-500"
        data-testid="manual-apply-helper-footnote"
      >
        Note: this preview is based on your saved profile data, not a live scan
        of the application page. The real form may have additional questions
        the assistant can't see in dry-run mode — fill those manually.
      </p>
    </section>
  );
}
