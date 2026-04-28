import type {
  ApplicationAnswer,
  ApplicationPackage,
  BrowserApplicationSession,
  NormalizedJob,
  Resume,
  UserProfile
} from "../models/domain";

/**
 * Manual-apply helper.
 *
 * The Browser Assistant (Phase 5) runs in dry-run mode by default —
 * it computes what fields a real browser adapter WOULD fill, but
 * doesn't actually drive the page. When the user opts to "manual
 * apply" they need a clear, copyable summary of every value the
 * assistant prepared so they can paste it into the real
 * application form themselves.
 *
 * This module is a pure assembler — no I/O, no React. It pulls the
 * full (non-redacted) profile fields, the package's resume +
 * cover letter drafts, and any short-answer drafts, and assembles
 * them into a list the UI can render with copy-to-clipboard
 * buttons next to each value.
 *
 * Privacy contract:
 * - The Browser Assistant session stores `valuePreview` strings
 *   (often redacted, e.g. "g***@example.com"). Those are useful
 *   for the dry-run UI but USELESS for paste-into-form.
 * - This helper bypasses the redacted preview and reads the raw
 *   value from the source entity (profile / resume / answer).
 *   That's correct because the user is opting to paste these
 *   values themselves; they're going through the candidate's own
 *   eyes, not into a log.
 */

export interface ManualApplyField {
  /** Field label as the application form labels it (e.g. "First Name"). */
  label: string;
  /** Full value the user should paste. */
  value: string;
  /** Where the value came from (profile / resume / answer / package). */
  sourceLabel: string;
}

export interface ManualApplyAnswer {
  question: string;
  answer: string;
  /** "saved_library" answers carry over from the personal library. */
  fromLibrary: boolean;
}

export interface ManualApplyPauseItem {
  label: string;
  reason: string;
}

export interface ManualApplyHelperData {
  /** Direct URL to open the application form (job.applicationUrl). */
  jobUrl: string;
  /** Human-readable job header for the helper card. */
  jobLabel: string;
  /** Filename of the resume the user should upload (when present). */
  resumeFileName: string | null;
  /** Direct text fields the user should paste (name / email / phone / etc). */
  fields: ManualApplyField[];
  /** Cover letter text (only when the package opted in). */
  coverLetter: string | null;
  /** Short answers (only when the package opted in). */
  shortAnswers: ManualApplyAnswer[];
  /** Items the assistant can't help with (CAPTCHA / Final submit / Gender). */
  pauseItems: ManualApplyPauseItem[];
}

function firstName(fullName: string): string {
  const trimmed = fullName.trim();
  if (trimmed.length === 0) return "";
  const parts = trimmed.split(/\s+/);
  return parts[0] ?? "";
}

function lastName(fullName: string): string {
  const trimmed = fullName.trim();
  if (trimmed.length === 0) return "";
  const parts = trimmed.split(/\s+/);
  return parts.length > 1 ? parts.slice(1).join(" ") : "";
}

/**
 * Map a session field-detected `id` (e.g. "first_name", "email")
 * to a (label, value) pair, pulling the full value from the
 * candidate's profile / resume / answers. Returns `null` when the
 * source has nothing to fill — the UI should hide those rows
 * rather than showing an empty value.
 */
function resolveFieldValue(input: {
  fieldId: string;
  fieldLabel: string;
  profile: UserProfile | null;
  resume: Resume | null;
  applicationPackage: ApplicationPackage;
  answers: ApplicationAnswer[];
}): ManualApplyField | null {
  const { fieldId, fieldLabel, profile, resume, applicationPackage, answers } = input;
  const id = fieldId.toLowerCase();

  if (id.includes("first") && id.includes("name")) {
    const value = firstName(profile?.fullName ?? "");
    if (!value) return null;
    return { label: fieldLabel, value, sourceLabel: "profile" };
  }
  if (id.includes("last") && id.includes("name")) {
    const value = lastName(profile?.fullName ?? "");
    if (!value) return null;
    return { label: fieldLabel, value, sourceLabel: "profile" };
  }
  if (id.includes("full") && id.includes("name")) {
    const value = profile?.fullName?.trim() ?? "";
    if (!value) return null;
    return { label: fieldLabel, value, sourceLabel: "profile" };
  }
  if (id === "email" || id.endsWith("_email")) {
    const value = profile?.email?.trim() ?? "";
    if (!value) return null;
    return { label: fieldLabel, value, sourceLabel: "profile" };
  }
  if (id === "phone" || id.endsWith("_phone")) {
    const value = profile?.phone?.trim() ?? "";
    if (!value) return null;
    return { label: fieldLabel, value, sourceLabel: "profile" };
  }
  if (id.includes("location") || id.includes("city")) {
    const value = profile?.location?.trim() ?? "";
    if (!value) return null;
    return { label: fieldLabel, value, sourceLabel: "profile" };
  }
  if (id.includes("linkedin")) {
    const value = profile?.linkedinUrl?.trim() ?? "";
    if (!value) return null;
    return { label: fieldLabel, value, sourceLabel: "profile" };
  }
  if (id.includes("github")) {
    const value = profile?.githubUrl?.trim() ?? "";
    if (!value) return null;
    return { label: fieldLabel, value, sourceLabel: "profile" };
  }
  if (id.includes("portfolio") || id.includes("website")) {
    const value = profile?.portfolioUrl?.trim() ?? "";
    if (!value) return null;
    return { label: fieldLabel, value, sourceLabel: "profile" };
  }
  if (id.includes("authorization") || id.includes("authorised") || id.includes("authorized")) {
    const value = profile?.workAuthorization?.trim() ?? "";
    if (!value) return null;
    return { label: fieldLabel, value, sourceLabel: "profile" };
  }

  // For free-text fields ("What makes you a strong fit?", etc.) the
  // session label is what the user will see on the form. Try to
  // match a saved answer by question label.
  const matchingAnswer = answers.find((answer) => {
    const normalizedQuestion = answer.question.toLowerCase();
    const normalizedLabel = fieldLabel.toLowerCase();
    return (
      normalizedQuestion === normalizedLabel ||
      normalizedQuestion.replace(/[^a-z0-9]+/g, " ").trim() ===
        normalizedLabel.replace(/[^a-z0-9]+/g, " ").trim()
    );
  });
  if (matchingAnswer && matchingAnswer.answer.trim().length > 0) {
    return {
      label: fieldLabel,
      value: matchingAnswer.answer,
      sourceLabel:
        matchingAnswer.source === "saved_library"
          ? "saved answer library"
          : matchingAnswer.source === "user_edited"
            ? "your edits"
            : "generated draft"
    };
  }

  // Resume / cover letter fields are surfaced separately (not in
  // the row list) because they're attachments / longer-form blocks.
  if (id === "resume" || id === "cover_letter") {
    return null;
  }

  // Avoid unused-variable lint when resume / package aren't directly
  // consulted in any branch — they're surfaced at the helper level
  // (resumeFileName, coverLetter), not per-field.
  void resume;
  void applicationPackage;
  return null;
}

export function buildManualApplyHelper(input: {
  session: BrowserApplicationSession;
  job: NormalizedJob;
  profile: UserProfile | null;
  resume: Resume | null;
  applicationPackage: ApplicationPackage;
  answers: ApplicationAnswer[];
}): ManualApplyHelperData {
  const { session, job, profile, resume, applicationPackage, answers } = input;

  // Build one row per session-detected field. Skip fields the session
  // already classifies as a "pause" (CAPTCHA / final submit / etc.) —
  // those go into pauseItems instead.
  const pauseFieldIds = new Set(
    session.uncertainFields.map((field) => field.fieldId)
  );

  const fields: ManualApplyField[] = [];
  const seenValues = new Set<string>();
  for (const detected of session.fieldsDetected) {
    if (pauseFieldIds.has(detected.id)) continue;
    const resolved = resolveFieldValue({
      fieldId: detected.id,
      fieldLabel: detected.label,
      profile,
      resume,
      applicationPackage,
      answers
    });
    if (!resolved) continue;
    // Avoid duplicating identical (label, value) pairs (Greenhouse
    // sometimes shows the same field twice with slightly different
    // ids — first_name + first_name_alt).
    const dedupeKey = `${resolved.label}::${resolved.value}`;
    if (seenValues.has(dedupeKey)) continue;
    seenValues.add(dedupeKey);
    fields.push(resolved);
  }

  const shortAnswers: ManualApplyAnswer[] = applicationPackage.shortAnswersIncluded
    ? answers
        .filter((answer) => answer.answer.trim().length > 0)
        .map((answer) => ({
          question: answer.question,
          answer: answer.answer,
          fromLibrary: answer.source === "saved_library"
        }))
    : [];

  const coverLetter =
    applicationPackage.coverLetterIncluded &&
    applicationPackage.coverLetter.trim().length > 0
      ? applicationPackage.coverLetter
      : null;

  const pauseItems: ManualApplyPauseItem[] = session.uncertainFields.map(
    (field) => ({
      label: field.label,
      // `guidance` is the human-readable explanation; `reason` is an
      // enum tag like "captcha" / "demographic" / "final_submit".
      reason: field.guidance
    })
  );

  return {
    jobUrl: job.applicationUrl,
    jobLabel: `${job.title} at ${job.company}`,
    resumeFileName: resume?.originalFileName ?? null,
    fields,
    coverLetter,
    shortAnswers,
    pauseItems
  };
}
