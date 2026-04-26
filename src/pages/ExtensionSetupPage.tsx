import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Info,
  ListChecks,
  Plug,
  ShieldAlert,
  ShieldCheck,
  Wrench
} from "lucide-react";
import type {
  AuditLog,
  ExtensionSession,
  UsageMeteringEvent
} from "../models/domain";
import {
  extensionDiagnostics,
  extensionSafetyStatus,
  isExtensionAuditAction,
  isExtensionUsageEvent,
  latestExtensionSession,
  type ExtensionSubmitGate
} from "../services/extensionService";

interface ExtensionSetupPageProps {
  extensionSessions: ExtensionSession[];
  auditLogs: AuditLog[];
  usageEvents: UsageMeteringEvent[];
  demoApplicationUrl: string;
}

function statusLabel(value: string): string {
  return value.replace(/_/g, " ");
}

function StatusPill({
  tone,
  children
}: {
  tone: "good" | "warn" | "bad" | "neutral";
  children: React.ReactNode;
}) {
  const palette =
    tone === "good"
      ? "bg-emerald-50 text-emerald-700"
      : tone === "warn"
        ? "bg-amber-50 text-amber-700"
        : tone === "bad"
          ? "bg-red-50 text-red-700"
          : "bg-slate-100 text-slate-700";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold capitalize ${palette}`}
    >
      {children}
    </span>
  );
}

function statusTone(status: string | null): "good" | "warn" | "bad" | "neutral" {
  if (!status) return "neutral";
  if (status === "submitted" || status === "submit_approved") return "good";
  if (
    status === "connected" ||
    status === "page_analyzed" ||
    status === "fill_plan_ready" ||
    status === "fill_approved" ||
    status === "fields_filled" ||
    status === "ready_for_final_review"
  ) {
    return "good";
  }
  if (status === "manual_required" || status === "awaiting_user_authorization") {
    return "warn";
  }
  if (status === "failed" || status === "disconnected") return "bad";
  return "neutral";
}

function Step({
  number,
  title,
  children
}: {
  number: number;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <li className="flex gap-3">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-xs font-semibold text-emerald-700">
        {number}
      </span>
      <div className="text-sm leading-6 text-slate-700">
        <p className="font-semibold text-slate-900">{title}</p>
        {children && <div className="mt-1 text-slate-600">{children}</div>}
      </div>
    </li>
  );
}

function SectionCard({
  icon: Icon,
  title,
  children,
  tone = "neutral"
}: {
  icon: typeof Plug;
  title: string;
  children: React.ReactNode;
  tone?: "neutral" | "good" | "warn";
}) {
  const headerTone =
    tone === "good"
      ? "bg-emerald-50 text-emerald-700"
      : tone === "warn"
        ? "bg-amber-50 text-amber-700"
        : "bg-slate-100 text-slate-700";
  return (
    <section className="rounded-lg border border-line bg-white p-5 shadow-soft">
      <div className="flex items-center gap-3">
        <div
          className={`flex h-9 w-9 items-center justify-center rounded-md ${headerTone}`}
        >
          <Icon aria-hidden="true" size={18} />
        </div>
        <h3 className="text-base font-semibold text-slate-950">{title}</h3>
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function SubmitGateCard({ gate }: { gate: ExtensionSubmitGate }) {
  if (!gate.blocked) {
    return (
      <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3">
        <div className="flex items-start gap-2">
          <CheckCircle2
            aria-hidden="true"
            className="mt-0.5 shrink-0 text-emerald-700"
            size={17}
          />
          <div>
            <p className="text-sm font-semibold text-emerald-900">
              Submit allowed
            </p>
            <p className="mt-1 text-sm leading-6 text-emerald-800">
              All approval guardrails are satisfied. The extension can record a
              submit confirmation when the user completes the action.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
      <div className="flex items-start gap-2">
        <ShieldAlert
          aria-hidden="true"
          className="mt-0.5 shrink-0 text-amber-800"
          size={17}
        />
        <div>
          <p className="text-sm font-semibold text-amber-950">
            Submit blocked
          </p>
          <p className="mt-1 text-sm leading-6 text-amber-900">{gate.message}</p>
          <p className="mt-1 text-xs uppercase tracking-wide text-amber-700">
            Code: {gate.code}
          </p>
        </div>
      </div>
    </div>
  );
}

export function ExtensionSetupPage({
  extensionSessions,
  auditLogs,
  usageEvents,
  demoApplicationUrl
}: ExtensionSetupPageProps) {
  const session = latestExtensionSession(extensionSessions);
  const diagnostics = extensionDiagnostics(session, null);
  const recentExtensionAudits = auditLogs
    .filter((log) => isExtensionAuditAction(log.action))
    .slice(0, 8);
  const recentExtensionUsage = usageEvents
    .filter((event) => isExtensionUsageEvent(event.eventType))
    .slice(0, 8);

  return (
    <div className="space-y-6">
      <header className="max-w-3xl">
        <p className="text-sm font-semibold uppercase tracking-wide text-emerald-700">
          Extension setup
        </p>
        <h2 className="mt-2 text-3xl font-semibold text-slate-950">
          Install, test, and validate the local browser extension
        </h2>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          The extension inspects job application pages you authorize and fills
          only fields you approve. It runs in dry-run or fill-only mode by
          default. The application is never submitted without explicit human
          approval.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <StatusPill tone="good">
            <ShieldCheck aria-hidden="true" size={14} />
            Live submit disabled
          </StatusPill>
          <StatusPill tone="good">
            <ShieldCheck aria-hidden="true" size={14} />
            Default mode dry run
          </StatusPill>
          <StatusPill tone="good">
            <ShieldCheck aria-hidden="true" size={14} />
            CAPTCHA bypass disabled
          </StatusPill>
          <StatusPill tone="good">
            <ShieldCheck aria-hidden="true" size={14} />
            Credential capture disabled
          </StatusPill>
        </div>
      </header>

      <section className="rounded-lg border border-amber-200 bg-amber-50 p-4">
        <div className="flex items-start gap-3">
          <ShieldAlert
            aria-hidden="true"
            className="mt-0.5 shrink-0 text-amber-800"
            size={18}
          />
          <p className="text-sm leading-6 text-amber-900">
            This phase is for safe dry-run and fill-only validation. The
            extension never submits an application without explicit user
            approval, never bypasses CAPTCHA, never reads passwords, and never
            stores credentials.
          </p>
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-2">
        <SectionCard icon={Plug} title="Install the local extension">
          <ol className="space-y-3">
            <Step number={1} title="Open Chrome extensions">
              Visit <code className="rounded bg-slate-100 px-1">chrome://extensions</code>{" "}
              in a new tab.
            </Step>
            <Step number={2} title="Enable Developer Mode">
              Toggle the Developer Mode switch in the upper right.
            </Step>
            <Step number={3} title="Click Load unpacked">
              A folder picker opens.
            </Step>
            <Step number={4} title="Select the extension folder">
              Choose the <code className="rounded bg-slate-100 px-1">extension/</code>{" "}
              folder from this project.
            </Step>
            <Step number={5} title="Open the demo application page">
              Use the link in Test demo flow below.
            </Step>
            <Step number={6} title="Click the Agentic Job Ops extension">
              The popup opens. No automatic page reads happen on install.
            </Step>
            <Step number={7} title="Connect to the local app">
              Click <strong>Connect to active tab</strong> in the popup. This is
              the explicit user authorization step.
            </Step>
          </ol>
        </SectionCard>

        <SectionCard icon={ExternalLink} title="Test demo flow">
          <p className="text-sm leading-6 text-slate-600">
            The local demo application page mimics a job application form and is
            the safe target for dry-run and fill-only validation.
          </p>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm leading-6 text-slate-600">
            <li>The demo page has no real submit. The button is a no-op.</li>
            <li>
              The extension popup never auto-fills sensitive demographic
              questions, password fields, or hidden authentication fields.
            </li>
            <li>
              Any CAPTCHA or sign-in challenge pauses the flow for the user.
            </li>
          </ul>
          <div className="mt-4 flex flex-wrap gap-2">
            <a
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-ink px-3 text-sm font-semibold text-white transition hover:bg-slate-700"
              href={demoApplicationUrl}
              rel="noreferrer"
              target="_blank"
            >
              <ExternalLink aria-hidden="true" size={16} />
              Open demo application page
            </a>
            <code className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-700">
              extension/demo/demo-application.html
            </code>
          </div>
        </SectionCard>
      </div>

      <SectionCard icon={ShieldCheck} title="Safety status" tone="good">
        <dl className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <SafetyRow
            label="Live submit"
            value="Disabled"
            description="The extension never triggers a real-world submit without explicit human approval."
          />
          <SafetyRow
            label="Default mode"
            value={statusLabel(extensionSafetyStatus.defaultMode)}
            description="Dry-run mode inspects page structure without filling fields. Fill-only mode fills approved safe fields without submitting."
          />
          <SafetyRow
            label="CAPTCHA bypass"
            value="Disabled"
            description="CAPTCHA, hCaptcha, and bot challenges always pause the flow for human action."
          />
          <SafetyRow
            label="Credential capture"
            value="Disabled"
            description="Passwords, hidden credential fields, and cookies are never read or sent."
          />
          <SafetyRow
            label="Sensitive autofill"
            value="Disabled unless user defaults exist"
            description="Demographic, salary, and unclear required fields pause for explicit user input."
          />
          <SafetyRow
            label="Submit gate"
            value={diagnostics.submit.blocked ? "Blocked" : "Allowed"}
            description={
              diagnostics.submit.blocked
                ? diagnostics.submit.message
                : "All current approval guardrails are satisfied."
            }
            tone={diagnostics.submit.blocked ? "warn" : "good"}
          />
        </dl>
      </SectionCard>

      <SectionCard icon={Info} title="Latest extension session">
        {!diagnostics.hasSession ? (
          <p className="text-sm text-slate-500">
            No extension session has been recorded yet. Connect the extension on
            a job application page (or use the demo flow on the Browser session
            review page) to populate this view.
          </p>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <StatusPill tone={statusTone(diagnostics.status)}>
                Status {statusLabel(diagnostics.status ?? "unknown")}
              </StatusPill>
              <StatusPill tone="neutral">
                {diagnostics.detectedFieldCount} fields detected
              </StatusPill>
              <StatusPill tone="neutral">
                {diagnostics.fillCount} planned fills
              </StatusPill>
              <StatusPill tone={diagnostics.pauseCount > 0 ? "warn" : "neutral"}>
                {diagnostics.pauseCount} paused
              </StatusPill>
              <StatusPill tone="neutral">
                {diagnostics.filledCount} actually filled
              </StatusPill>
              <StatusPill
                tone={diagnostics.submit.blocked ? "warn" : "good"}
              >
                Submit {diagnostics.submit.blocked ? "blocked" : "allowed"}
              </StatusPill>
            </div>
            <dl className="grid gap-3 text-sm md:grid-cols-2">
              <div>
                <dt className="text-xs uppercase tracking-wide text-slate-500">
                  Page title
                </dt>
                <dd className="mt-1 text-slate-900">
                  {diagnostics.pageTitle || "(untitled)"}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-slate-500">
                  Connected URL
                </dt>
                <dd className="mt-1 break-all text-slate-900">
                  {diagnostics.pageUrl || "(no url)"}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-slate-500">
                  Hostname
                </dt>
                <dd className="mt-1 text-slate-900">
                  {diagnostics.hostname || "(unknown)"}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-slate-500">
                  Last updated
                </dt>
                <dd className="mt-1 text-slate-900">
                  {diagnostics.lastUpdatedAt
                    ? new Date(diagnostics.lastUpdatedAt).toLocaleString()
                    : "—"}
                </dd>
              </div>
            </dl>
            <SubmitGateCard gate={diagnostics.submit} />
          </div>
        )}
      </SectionCard>

      <div className="grid gap-5 xl:grid-cols-2">
        <SectionCard icon={ListChecks} title="Detected fields">
          {diagnostics.detectedFields.length === 0 ? (
            <p className="text-sm text-slate-500">No detected fields yet.</p>
          ) : (
            <DiagnosticTable
              headers={["Label", "Type", "Source", "Required", "Confidence"]}
              rows={diagnostics.detectedFields.map((field) => [
                field.label,
                statusLabel(field.fieldType),
                statusLabel(field.source),
                field.required ? "yes" : "no",
                `${Math.round(field.confidence * 100)}%`
              ])}
            />
          )}
        </SectionCard>

        <SectionCard icon={ListChecks} title="Fill plan">
          {diagnostics.fillPlan.length === 0 ? (
            <p className="text-sm text-slate-500">No fill plan available yet.</p>
          ) : (
            <DiagnosticTable
              headers={["Label", "Action", "Source", "Note"]}
              rows={diagnostics.fillPlan.map((item) => [
                item.label,
                statusLabel(item.action),
                statusLabel(item.source),
                item.reason || item.valuePreview || ""
              ])}
            />
          )}
        </SectionCard>
      </div>

      <SectionCard icon={AlertTriangle} title="Paused or blocked fields">
        {diagnostics.pausedFields.length === 0 ? (
          <p className="text-sm text-slate-500">
            No paused fields. CAPTCHA, login challenges, and sensitive
            demographic questions always pause for human review.
          </p>
        ) : (
          <div className="space-y-3">
            {diagnostics.pausedFields.map((field) => (
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
                      {field.label}{" "}
                      <span className="text-xs font-normal text-amber-700">
                        · {statusLabel(field.reason)}
                      </span>
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
      </SectionCard>

      <div className="grid gap-5 xl:grid-cols-2">
        <SectionCard icon={Info} title="Recent extension audit events">
          {recentExtensionAudits.length === 0 ? (
            <p className="text-sm text-slate-500">No extension audit events yet.</p>
          ) : (
            <ul className="space-y-2">
              {recentExtensionAudits.map((log) => (
                <li
                  key={log.id}
                  className="rounded-md border border-slate-200 p-3"
                >
                  <p className="text-sm font-semibold text-slate-900">
                    {statusLabel(log.action)}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {new Date(log.createdAt).toLocaleString()}
                  </p>
                  {typeof log.metadata.reason === "string" && (
                    <p className="mt-1 text-xs text-amber-800">
                      Reason: {statusLabel(log.metadata.reason)}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard icon={Info} title="Recent extension usage events">
          {recentExtensionUsage.length === 0 ? (
            <p className="text-sm text-slate-500">No extension usage events yet.</p>
          ) : (
            <ul className="space-y-2">
              {recentExtensionUsage.map((event) => (
                <li
                  key={event.id}
                  className="rounded-md border border-slate-200 p-3"
                >
                  <p className="text-sm font-semibold text-slate-900">
                    {statusLabel(event.eventType)}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {new Date(event.createdAt).toLocaleString()} ·{" "}
                    {event.quantity} {event.unit}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      <SectionCard icon={Wrench} title="Troubleshooting">
        <ul className="space-y-3 text-sm leading-6 text-slate-700">
          <TroubleshootItem title="Extension not loaded">
            Open <code className="rounded bg-slate-100 px-1">chrome://extensions</code>,
            confirm the extension is enabled, and reload it after pulling new
            changes. The action button must be pinned to the toolbar.
          </TroubleshootItem>
          <TroubleshootItem title="Local app not running">
            Start the dev server with{" "}
            <code className="rounded bg-slate-100 px-1">npm run dev</code> and
            confirm it is reachable at{" "}
            <code className="rounded bg-slate-100 px-1">
              http://127.0.0.1:5174
            </code>
            . The extension only talks to that origin.
          </TroubleshootItem>
          <TroubleshootItem title="Page not authorized">
            Click <strong>Connect to active tab</strong> in the popup before any
            inspection. The extension never reads pages without this explicit
            authorization step.
          </TroubleshootItem>
          <TroubleshootItem title="No fields detected">
            Some application pages require sign-in or render forms after
            JavaScript loads. Sign in manually first, wait for the form, then
            click <strong>Read page structure</strong>.
          </TroubleshootItem>
          <TroubleshootItem title="Submit blocked">
            Submit requires the package to be approved, the session to reach
            the final review state, an explicit submit approval from the job
            seeker, and no remaining captcha or login pause. The latest session
            card above shows the exact reason.
          </TroubleshootItem>
          <TroubleshootItem title="Manual required">
            CAPTCHA, sign-in, or sensitive demographic questions force the
            session into a manual_required state. Complete those manually and
            keep dry-run validation focused on safe fields.
          </TroubleshootItem>
        </ul>
      </SectionCard>
    </div>
  );
}

function SafetyRow({
  label,
  value,
  description,
  tone = "good"
}: {
  label: string;
  value: string;
  description: string;
  tone?: "good" | "warn";
}) {
  return (
    <div className="rounded-md border border-slate-200 p-3">
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p
        className={`mt-1 text-sm font-semibold capitalize ${
          tone === "good" ? "text-emerald-700" : "text-amber-800"
        }`}
      >
        {value}
      </p>
      <p className="mt-1 text-xs leading-5 text-slate-600">{description}</p>
    </div>
  );
}

function DiagnosticTable({
  headers,
  rows
}: {
  headers: string[];
  rows: (string | number)[][];
}) {
  return (
    <div className="overflow-x-auto rounded-md border border-slate-200">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50">
          <tr>
            {headers.map((header) => (
              <th
                key={header}
                className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500"
              >
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 bg-white">
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, cellIndex) => (
                <td
                  key={cellIndex}
                  className="px-3 py-2 text-slate-700"
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TroubleshootItem({
  title,
  children
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <li className="rounded-md border border-slate-200 p-3">
      <p className="text-sm font-semibold text-slate-900">{title}</p>
      <p className="mt-1 text-sm leading-6 text-slate-600">{children}</p>
    </li>
  );
}
