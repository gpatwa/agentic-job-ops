import {
  AlertTriangle,
  Bell,
  CalendarClock,
  CheckCircle2,
  ClipboardCopy,
  Mail,
  MessageSquarePlus,
  Plus,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  UserPlus
} from "lucide-react";
import { useMemo, useState } from "react";
import type {
  ApplicationRecord,
  FollowUpReminder,
  InterviewNote,
  InterviewStage,
  NormalizedJob,
  OutreachDraft,
  OutreachDraftStatus,
  OutreachDraftType,
  RecruiterContact
} from "../models/domain";
import {
  followUpReminderStatuses,
  interviewStages,
  outreachDraftTypes
} from "../models/domain";

export interface CrmPanelProps {
  application: ApplicationRecord;
  job: NormalizedJob | null;
  contacts: RecruiterContact[];
  drafts: OutreachDraft[];
  reminders: FollowUpReminder[];
  interviewNotes: InterviewNote[];
  onAddContact: (input: {
    name: string;
    title: string;
    email: string;
    publicProfileUrl: string;
    notes: string;
  }) => void;
  onGenerateDraft: (input: {
    type: OutreachDraftType;
    recruiterContactId: string | null;
  }) => void;
  onUpdateDraft: (input: {
    id: string;
    subject?: string;
    body?: string;
    status?: OutreachDraftStatus;
  }) => void;
  onMarkDraftHelpful: (draftId: string) => void;
  onMarkDraftNotHelpful: (draftId: string) => void;
  onCreateReminder: (input: {
    dueAt: string;
    reason: string;
    recruiterContactId: string | null;
  }) => void;
  onUpdateReminderStatus: (
    reminderId: string,
    status: FollowUpReminder["status"]
  ) => void;
  onAddInterviewNote: (input: {
    stage: InterviewStage;
    scheduledAt: string | null;
    interviewerNames: string[];
    notes: string;
    questionsAsked: string[];
    followUps: string[];
  }) => void;
  onMarkInterviewNoteUsed: (noteId: string) => void;
  draftError: string | null;
  onClearDraftError: () => void;
}

function statusLabel(value: string): string {
  return value.replace(/_/g, " ");
}

function draftTypeLabel(type: OutreachDraftType): string {
  return type.replace(/_/g, " ");
}

function stageLabel(stage: InterviewStage): string {
  return stage.replace(/_/g, " ");
}

function gateRequirement(type: OutreachDraftType): string | null {
  switch (type) {
    case "follow_up":
      return "Application status must be submitted, recruiter contacted, or interviewing.";
    case "thank_you":
      return "Requires an interview note or interviewing/offer status.";
    case "negotiation":
      return "Application status must be offer.";
    case "rejection_response":
      return "Application status must be rejected.";
    case "interview_availability":
      return "Application status must be recruiter contacted or interviewing.";
    default:
      return null;
  }
}

function copyToClipboard(text: string): void {
  if (typeof navigator !== "undefined" && navigator.clipboard) {
    void navigator.clipboard.writeText(text);
  }
}

function ContactsSection({
  contacts,
  onAddContact
}: {
  contacts: RecruiterContact[];
  onAddContact: CrmPanelProps["onAddContact"];
}) {
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [email, setEmail] = useState("");
  const [publicProfileUrl, setPublicProfileUrl] = useState("");
  const [notes, setNotes] = useState("");

  function reset() {
    setName("");
    setTitle("");
    setEmail("");
    setPublicProfileUrl("");
    setNotes("");
    setShowForm(false);
  }

  return (
    <section className="rounded-md border border-slate-200 bg-white p-4">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <UserPlus aria-hidden="true" size={16} className="text-emerald-700" />
          <h5 className="text-sm font-semibold text-slate-950">Recruiter contacts</h5>
        </div>
        <button
          type="button"
          className="inline-flex min-h-8 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
          onClick={() => setShowForm((open) => !open)}
        >
          <Plus aria-hidden="true" size={13} />
          {showForm ? "Cancel" : "Add contact"}
        </button>
      </header>

      <p className="mt-2 text-xs text-slate-500">
        Add contacts you found yourself or were introduced to. The assistant never
        scrapes LinkedIn or invents recruiter names.
      </p>

      {showForm && (
        <form
          className="mt-3 grid gap-2 rounded-md border border-slate-200 bg-panel p-3 sm:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            onAddContact({
              name: name.trim(),
              title: title.trim(),
              email: email.trim(),
              publicProfileUrl: publicProfileUrl.trim(),
              notes: notes.trim()
            });
            reset();
          }}
        >
          <label className="space-y-1 text-xs">
            <span className="font-medium text-slate-700">Name</span>
            <input
              type="text"
              className="min-h-9 w-full rounded-md border border-slate-300 bg-white px-2.5 text-sm text-slate-900"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Optional"
            />
          </label>
          <label className="space-y-1 text-xs">
            <span className="font-medium text-slate-700">Title</span>
            <input
              type="text"
              className="min-h-9 w-full rounded-md border border-slate-300 bg-white px-2.5 text-sm text-slate-900"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Optional"
            />
          </label>
          <label className="space-y-1 text-xs">
            <span className="font-medium text-slate-700">Email</span>
            <input
              type="email"
              className="min-h-9 w-full rounded-md border border-slate-300 bg-white px-2.5 text-sm text-slate-900"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="Optional"
            />
          </label>
          <label className="space-y-1 text-xs">
            <span className="font-medium text-slate-700">Public profile URL</span>
            <input
              type="url"
              className="min-h-9 w-full rounded-md border border-slate-300 bg-white px-2.5 text-sm text-slate-900"
              value={publicProfileUrl}
              onChange={(event) => setPublicProfileUrl(event.target.value)}
              placeholder="Optional"
            />
          </label>
          <label className="sm:col-span-2 space-y-1 text-xs">
            <span className="font-medium text-slate-700">Notes</span>
            <textarea
              className="min-h-16 w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </label>
          <div className="sm:col-span-2 flex justify-end">
            <button
              type="submit"
              className="inline-flex min-h-9 items-center gap-1.5 rounded-md bg-emerald-700 px-3 text-xs font-semibold text-white transition hover:bg-emerald-800"
            >
              <Plus aria-hidden="true" size={13} />
              Save contact
            </button>
          </div>
        </form>
      )}

      {contacts.length === 0 ? (
        <p className="mt-3 text-xs text-slate-500">No contacts yet for this application.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {contacts.map((contact) => (
            <li
              key={contact.id}
              className="rounded-md border border-slate-200 bg-panel p-3 text-sm text-slate-700"
            >
              <p className="font-semibold text-slate-950">
                {contact.name || "Unnamed contact"}
                {contact.title ? ` · ${contact.title}` : ""}
              </p>
              <p className="text-xs text-slate-500">
                {contact.company} · {statusLabel(contact.source)} · confidence {contact.confidence}
              </p>
              {contact.email && (
                <p className="mt-1 text-xs text-slate-600">{contact.email}</p>
              )}
              {contact.publicProfileUrl && (
                <a
                  href={contact.publicProfileUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 block text-xs text-emerald-700 underline"
                >
                  Public profile
                </a>
              )}
              {contact.notes && (
                <p className="mt-2 text-xs leading-5 text-slate-600">{contact.notes}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function DraftsSection({
  application,
  contacts,
  drafts,
  draftError,
  onGenerateDraft,
  onUpdateDraft,
  onMarkDraftHelpful,
  onMarkDraftNotHelpful,
  onClearDraftError
}: {
  application: ApplicationRecord;
  contacts: RecruiterContact[];
  drafts: OutreachDraft[];
  draftError: string | null;
  onGenerateDraft: CrmPanelProps["onGenerateDraft"];
  onUpdateDraft: CrmPanelProps["onUpdateDraft"];
  onMarkDraftHelpful: CrmPanelProps["onMarkDraftHelpful"];
  onMarkDraftNotHelpful: CrmPanelProps["onMarkDraftNotHelpful"];
  onClearDraftError: CrmPanelProps["onClearDraftError"];
}) {
  const [type, setType] = useState<OutreachDraftType>("recruiter_intro");
  const [contactId, setContactId] = useState<string>("");
  const requirement = gateRequirement(type);

  return (
    <section className="rounded-md border border-slate-200 bg-white p-4">
      <header className="flex items-center gap-2">
        <Sparkles aria-hidden="true" size={16} className="text-emerald-700" />
        <h5 className="text-sm font-semibold text-slate-950">Outreach drafts</h5>
      </header>
      <p className="mt-2 text-xs text-slate-500">
        Drafts are deterministic and never auto-sent. Approve and copy when you're
        ready to send manually.
      </p>

      <div className="mt-3 grid gap-2 rounded-md border border-slate-200 bg-panel p-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <label className="space-y-1 text-xs">
          <span className="font-medium text-slate-700">Type</span>
          <select
            className="min-h-9 w-full rounded-md border border-slate-300 bg-white px-2.5 text-sm capitalize text-slate-900"
            value={type}
            onChange={(event) => setType(event.target.value as OutreachDraftType)}
          >
            {outreachDraftTypes.map((value) => (
              <option key={value} value={value}>
                {draftTypeLabel(value)}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-xs">
          <span className="font-medium text-slate-700">Recipient</span>
          <select
            className="min-h-9 w-full rounded-md border border-slate-300 bg-white px-2.5 text-sm text-slate-900"
            value={contactId}
            onChange={(event) => setContactId(event.target.value)}
          >
            <option value="">No contact (use generic salutation)</option>
            {contacts.map((contact) => (
              <option key={contact.id} value={contact.id}>
                {contact.name || "Unnamed contact"}{" "}
                {contact.title ? `· ${contact.title}` : ""}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-md bg-emerald-700 px-3 text-xs font-semibold text-white transition hover:bg-emerald-800"
          onClick={() =>
            onGenerateDraft({
              type,
              recruiterContactId: contactId || null
            })
          }
        >
          <MessageSquarePlus aria-hidden="true" size={13} />
          Generate draft
        </button>
      </div>

      {requirement && (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-slate-500">
          <AlertTriangle aria-hidden="true" size={12} />
          {requirement} Current status: {statusLabel(application.status)}.
        </p>
      )}

      {draftError && (
        <div className="mt-3 flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
          <AlertTriangle aria-hidden="true" size={14} />
          <div className="flex-1">{draftError}</div>
          <button
            type="button"
            className="text-xs font-semibold underline"
            onClick={onClearDraftError}
          >
            Dismiss
          </button>
        </div>
      )}

      {drafts.length === 0 ? (
        <p className="mt-3 text-xs text-slate-500">No drafts yet.</p>
      ) : (
        <ul className="mt-3 space-y-3">
          {drafts.map((draft) => (
            <DraftItem
              key={draft.id}
              draft={draft}
              onUpdateDraft={onUpdateDraft}
              onMarkDraftHelpful={onMarkDraftHelpful}
              onMarkDraftNotHelpful={onMarkDraftNotHelpful}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function DraftItem({
  draft,
  onUpdateDraft,
  onMarkDraftHelpful,
  onMarkDraftNotHelpful
}: {
  draft: OutreachDraft;
  onUpdateDraft: CrmPanelProps["onUpdateDraft"];
  onMarkDraftHelpful: CrmPanelProps["onMarkDraftHelpful"];
  onMarkDraftNotHelpful: CrmPanelProps["onMarkDraftNotHelpful"];
}) {
  const [editing, setEditing] = useState(false);
  const [subject, setSubject] = useState(draft.subject);
  const [body, setBody] = useState(draft.body);

  return (
    <li className="rounded-md border border-slate-200 bg-panel p-3 text-sm text-slate-700">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-semibold capitalize text-emerald-800">
          {draftTypeLabel(draft.type)}
        </span>
        <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-semibold capitalize text-slate-700">
          {statusLabel(draft.status)}
        </span>
        <span className="text-xs text-slate-500">
          Generated {new Date(draft.createdAt).toLocaleString()}
        </span>
      </div>

      {editing ? (
        <div className="mt-3 space-y-2">
          <label className="block space-y-1 text-xs">
            <span className="font-medium text-slate-700">Subject</span>
            <input
              type="text"
              className="min-h-9 w-full rounded-md border border-slate-300 bg-white px-2.5 text-sm text-slate-900"
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
            />
          </label>
          <label className="block space-y-1 text-xs">
            <span className="font-medium text-slate-700">Body</span>
            <textarea
              className="min-h-40 w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900"
              value={body}
              onChange={(event) => setBody(event.target.value)}
            />
          </label>
          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              className="inline-flex min-h-9 items-center rounded-md border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700"
              onClick={() => {
                setSubject(draft.subject);
                setBody(draft.body);
                setEditing(false);
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              className="inline-flex min-h-9 items-center rounded-md bg-slate-900 px-3 text-xs font-semibold text-white transition hover:bg-slate-700"
              onClick={() => {
                onUpdateDraft({ id: draft.id, subject, body });
                setEditing(false);
              }}
            >
              Save edits
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          <p className="text-sm font-semibold text-slate-950">{draft.subject}</p>
          <pre className="whitespace-pre-wrap rounded-md border border-slate-200 bg-white p-3 text-xs leading-5 text-slate-700">
            {draft.body}
          </pre>
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {!editing && (
          <button
            type="button"
            className="inline-flex min-h-8 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
            onClick={() => setEditing(true)}
          >
            Edit
          </button>
        )}
        <button
          type="button"
          className="inline-flex min-h-8 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
          onClick={() =>
            copyToClipboard(`Subject: ${draft.subject}\n\n${draft.body}`)
          }
        >
          <ClipboardCopy aria-hidden="true" size={12} />
          Copy
        </button>
        {draft.status !== "approved" && (
          <button
            type="button"
            className="inline-flex min-h-8 items-center gap-1.5 rounded-md bg-emerald-700 px-2.5 text-xs font-semibold text-white transition hover:bg-emerald-800"
            onClick={() => onUpdateDraft({ id: draft.id, status: "approved" })}
          >
            <CheckCircle2 aria-hidden="true" size={12} />
            Approve
          </button>
        )}
        {draft.status === "approved" && (
          <button
            type="button"
            className="inline-flex min-h-8 items-center gap-1.5 rounded-md bg-slate-900 px-2.5 text-xs font-semibold text-white transition hover:bg-slate-700"
            onClick={() => onUpdateDraft({ id: draft.id, status: "sent_manually" })}
          >
            <Mail aria-hidden="true" size={12} />
            Mark sent manually
          </button>
        )}
        <span className="ml-auto inline-flex items-center gap-1">
          <button
            type="button"
            className="inline-flex min-h-8 items-center gap-1 rounded-md border border-slate-300 bg-white px-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
            onClick={() => onMarkDraftHelpful(draft.id)}
            aria-label="Helpful"
          >
            <ThumbsUp aria-hidden="true" size={12} />
          </button>
          <button
            type="button"
            className="inline-flex min-h-8 items-center gap-1 rounded-md border border-slate-300 bg-white px-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
            onClick={() => onMarkDraftNotHelpful(draft.id)}
            aria-label="Not helpful"
          >
            <ThumbsDown aria-hidden="true" size={12} />
          </button>
        </span>
      </div>
    </li>
  );
}

function defaultReminderDueAt(): string {
  const date = new Date();
  date.setDate(date.getDate() + 5);
  return date.toISOString().slice(0, 10);
}

function RemindersSection({
  contacts,
  reminders,
  onCreateReminder,
  onUpdateReminderStatus
}: {
  contacts: RecruiterContact[];
  reminders: FollowUpReminder[];
  onCreateReminder: CrmPanelProps["onCreateReminder"];
  onUpdateReminderStatus: CrmPanelProps["onUpdateReminderStatus"];
}) {
  const [dueAt, setDueAt] = useState(defaultReminderDueAt());
  const [reason, setReason] = useState("");
  const [contactId, setContactId] = useState("");

  return (
    <section className="rounded-md border border-slate-200 bg-white p-4">
      <header className="flex items-center gap-2">
        <Bell aria-hidden="true" size={16} className="text-emerald-700" />
        <h5 className="text-sm font-semibold text-slate-950">Follow-up reminders</h5>
      </header>
      <p className="mt-2 text-xs text-slate-500">
        Reminders surface on the dashboard when due. Mark complete after you take
        action.
      </p>

      <form
        className="mt-3 grid gap-2 rounded-md border border-slate-200 bg-panel p-3 sm:grid-cols-[160px_1fr_1fr_auto] sm:items-end"
        onSubmit={(event) => {
          event.preventDefault();
          if (!reason.trim()) return;
          onCreateReminder({
            dueAt: new Date(`${dueAt}T09:00:00`).toISOString(),
            reason: reason.trim(),
            recruiterContactId: contactId || null
          });
          setReason("");
          setContactId("");
          setDueAt(defaultReminderDueAt());
        }}
      >
        <label className="space-y-1 text-xs">
          <span className="font-medium text-slate-700">Due date</span>
          <input
            type="date"
            className="min-h-9 w-full rounded-md border border-slate-300 bg-white px-2.5 text-sm text-slate-900"
            value={dueAt}
            onChange={(event) => setDueAt(event.target.value)}
          />
        </label>
        <label className="space-y-1 text-xs">
          <span className="font-medium text-slate-700">Reason</span>
          <input
            type="text"
            className="min-h-9 w-full rounded-md border border-slate-300 bg-white px-2.5 text-sm text-slate-900"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="e.g. Follow up if no reply"
          />
        </label>
        <label className="space-y-1 text-xs">
          <span className="font-medium text-slate-700">Contact</span>
          <select
            className="min-h-9 w-full rounded-md border border-slate-300 bg-white px-2.5 text-sm text-slate-900"
            value={contactId}
            onChange={(event) => setContactId(event.target.value)}
          >
            <option value="">No contact</option>
            {contacts.map((contact) => (
              <option key={contact.id} value={contact.id}>
                {contact.name || "Unnamed contact"}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-md bg-emerald-700 px-3 text-xs font-semibold text-white transition hover:bg-emerald-800"
        >
          <CalendarClock aria-hidden="true" size={13} />
          Add reminder
        </button>
      </form>

      {reminders.length === 0 ? (
        <p className="mt-3 text-xs text-slate-500">No reminders yet.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {reminders.map((reminder) => (
            <li
              key={reminder.id}
              className="flex flex-col gap-2 rounded-md border border-slate-200 bg-panel p-3 text-sm text-slate-700 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p className="font-semibold text-slate-950">{reminder.reason}</p>
                <p className="text-xs text-slate-500">
                  Due {new Date(reminder.dueAt).toLocaleDateString()} ·{" "}
                  {statusLabel(reminder.status)}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <select
                  className="min-h-8 rounded-md border border-slate-300 bg-white px-2 text-xs capitalize text-slate-900"
                  value={reminder.status}
                  onChange={(event) =>
                    onUpdateReminderStatus(
                      reminder.id,
                      event.target.value as FollowUpReminder["status"]
                    )
                  }
                >
                  {followUpReminderStatuses.map((status) => (
                    <option key={status} value={status}>
                      {statusLabel(status)}
                    </option>
                  ))}
                </select>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function InterviewNotesSection({
  notes,
  onAddInterviewNote,
  onMarkInterviewNoteUsed
}: {
  notes: InterviewNote[];
  onAddInterviewNote: CrmPanelProps["onAddInterviewNote"];
  onMarkInterviewNoteUsed: CrmPanelProps["onMarkInterviewNoteUsed"];
}) {
  const [showForm, setShowForm] = useState(false);
  const [stage, setStage] = useState<InterviewStage>("recruiter_screen");
  const [scheduledAt, setScheduledAt] = useState("");
  const [interviewerNames, setInterviewerNames] = useState("");
  const [notesText, setNotesText] = useState("");
  const [questionsAsked, setQuestionsAsked] = useState("");
  const [followUps, setFollowUps] = useState("");

  function reset() {
    setStage("recruiter_screen");
    setScheduledAt("");
    setInterviewerNames("");
    setNotesText("");
    setQuestionsAsked("");
    setFollowUps("");
    setShowForm(false);
  }

  return (
    <section className="rounded-md border border-slate-200 bg-white p-4">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CalendarClock
            aria-hidden="true"
            size={16}
            className="text-emerald-700"
          />
          <h5 className="text-sm font-semibold text-slate-950">Interview notes</h5>
        </div>
        <button
          type="button"
          className="inline-flex min-h-8 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
          onClick={() => setShowForm((open) => !open)}
        >
          <Plus aria-hidden="true" size={13} />
          {showForm ? "Cancel" : "Add note"}
        </button>
      </header>

      {showForm && (
        <form
          className="mt-3 grid gap-2 rounded-md border border-slate-200 bg-panel p-3 sm:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (!notesText.trim()) return;
            onAddInterviewNote({
              stage,
              scheduledAt: scheduledAt
                ? new Date(scheduledAt).toISOString()
                : null,
              interviewerNames: interviewerNames
                .split(",")
                .map((name) => name.trim())
                .filter((name) => name.length > 0),
              notes: notesText.trim(),
              questionsAsked: questionsAsked
                .split("\n")
                .map((question) => question.trim())
                .filter((question) => question.length > 0),
              followUps: followUps
                .split("\n")
                .map((followUp) => followUp.trim())
                .filter((followUp) => followUp.length > 0)
            });
            reset();
          }}
        >
          <label className="space-y-1 text-xs">
            <span className="font-medium text-slate-700">Stage</span>
            <select
              className="min-h-9 w-full rounded-md border border-slate-300 bg-white px-2.5 text-sm text-slate-900"
              value={stage}
              onChange={(event) => setStage(event.target.value as InterviewStage)}
            >
              {interviewStages.map((value) => (
                <option key={value} value={value}>
                  {stageLabel(value)}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-xs">
            <span className="font-medium text-slate-700">Scheduled (optional)</span>
            <input
              type="datetime-local"
              className="min-h-9 w-full rounded-md border border-slate-300 bg-white px-2.5 text-sm text-slate-900"
              value={scheduledAt}
              onChange={(event) => setScheduledAt(event.target.value)}
            />
          </label>
          <label className="sm:col-span-2 space-y-1 text-xs">
            <span className="font-medium text-slate-700">
              Interviewer names (comma separated, optional)
            </span>
            <input
              type="text"
              className="min-h-9 w-full rounded-md border border-slate-300 bg-white px-2.5 text-sm text-slate-900"
              value={interviewerNames}
              onChange={(event) => setInterviewerNames(event.target.value)}
            />
          </label>
          <label className="sm:col-span-2 space-y-1 text-xs">
            <span className="font-medium text-slate-700">Notes</span>
            <textarea
              className="min-h-20 w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900"
              value={notesText}
              onChange={(event) => setNotesText(event.target.value)}
            />
          </label>
          <label className="space-y-1 text-xs">
            <span className="font-medium text-slate-700">
              Questions asked (one per line)
            </span>
            <textarea
              className="min-h-16 w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900"
              value={questionsAsked}
              onChange={(event) => setQuestionsAsked(event.target.value)}
            />
          </label>
          <label className="space-y-1 text-xs">
            <span className="font-medium text-slate-700">
              Follow-ups (one per line)
            </span>
            <textarea
              className="min-h-16 w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900"
              value={followUps}
              onChange={(event) => setFollowUps(event.target.value)}
            />
          </label>
          <div className="sm:col-span-2 flex justify-end">
            <button
              type="submit"
              className="inline-flex min-h-9 items-center gap-1.5 rounded-md bg-emerald-700 px-3 text-xs font-semibold text-white transition hover:bg-emerald-800"
            >
              <Plus aria-hidden="true" size={13} />
              Save note
            </button>
          </div>
        </form>
      )}

      {notes.length === 0 ? (
        <p className="mt-3 text-xs text-slate-500">No interview notes yet.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {notes.map((note) => (
            <li
              key={note.id}
              className="rounded-md border border-slate-200 bg-panel p-3 text-sm text-slate-700"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-semibold capitalize text-slate-950">
                  {stageLabel(note.stage)}
                </span>
                <span className="text-xs text-slate-500">
                  {note.scheduledAt
                    ? new Date(note.scheduledAt).toLocaleString()
                    : `Logged ${new Date(note.createdAt).toLocaleDateString()}`}
                </span>
              </div>
              {note.interviewerNames.length > 0 && (
                <p className="mt-1 text-xs text-slate-500">
                  Interviewers: {note.interviewerNames.join(", ")}
                </p>
              )}
              <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">
                {note.notes}
              </p>
              {note.questionsAsked.length > 0 && (
                <details className="mt-2 text-xs text-slate-600">
                  <summary className="cursor-pointer font-semibold text-slate-700">
                    Questions asked ({note.questionsAsked.length})
                  </summary>
                  <ul className="mt-1 list-inside list-disc">
                    {note.questionsAsked.map((question) => (
                      <li key={question}>{question}</li>
                    ))}
                  </ul>
                </details>
              )}
              {note.followUps.length > 0 && (
                <details className="mt-2 text-xs text-slate-600">
                  <summary className="cursor-pointer font-semibold text-slate-700">
                    Follow-ups ({note.followUps.length})
                  </summary>
                  <ul className="mt-1 list-inside list-disc">
                    {note.followUps.map((followUp) => (
                      <li key={followUp}>{followUp}</li>
                    ))}
                  </ul>
                </details>
              )}
              <div className="mt-3 flex justify-end">
                <button
                  type="button"
                  className="inline-flex min-h-8 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                  onClick={() => onMarkInterviewNoteUsed(note.id)}
                >
                  Mark useful
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function CrmPanel(props: CrmPanelProps) {
  const sortedContacts = useMemo(
    () =>
      [...props.contacts].sort((a, b) =>
        b.createdAt.localeCompare(a.createdAt)
      ),
    [props.contacts]
  );
  const sortedDrafts = useMemo(
    () =>
      [...props.drafts].sort((a, b) =>
        b.createdAt.localeCompare(a.createdAt)
      ),
    [props.drafts]
  );
  const sortedReminders = useMemo(
    () =>
      [...props.reminders].sort((a, b) => a.dueAt.localeCompare(b.dueAt)),
    [props.reminders]
  );
  const sortedNotes = useMemo(
    () =>
      [...props.interviewNotes].sort((a, b) =>
        b.createdAt.localeCompare(a.createdAt)
      ),
    [props.interviewNotes]
  );

  return (
    <div className="mt-4 space-y-4 rounded-md border border-slate-200 bg-panel p-4">
      <div>
        <h4 className="text-sm font-semibold text-slate-950">
          Recruiter CRM
        </h4>
        <p className="mt-1 text-xs text-slate-500">
          Track contacts, draft outreach, schedule follow-ups, and capture
          interview notes for {props.job?.company ?? "this application"}.
        </p>
      </div>

      <ContactsSection
        contacts={sortedContacts}
        onAddContact={props.onAddContact}
      />
      <DraftsSection
        application={props.application}
        contacts={sortedContacts}
        drafts={sortedDrafts}
        draftError={props.draftError}
        onGenerateDraft={props.onGenerateDraft}
        onUpdateDraft={props.onUpdateDraft}
        onMarkDraftHelpful={props.onMarkDraftHelpful}
        onMarkDraftNotHelpful={props.onMarkDraftNotHelpful}
        onClearDraftError={props.onClearDraftError}
      />
      <RemindersSection
        contacts={sortedContacts}
        reminders={sortedReminders}
        onCreateReminder={props.onCreateReminder}
        onUpdateReminderStatus={props.onUpdateReminderStatus}
      />
      <InterviewNotesSection
        notes={sortedNotes}
        onAddInterviewNote={props.onAddInterviewNote}
        onMarkInterviewNoteUsed={props.onMarkInterviewNoteUsed}
      />
    </div>
  );
}
