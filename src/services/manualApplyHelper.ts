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
 * The Browser Assistant (Phase 5) runs in dry-run mode by default.
 * The static GreenhouseATSAdapter / LeverATSAdapter return a fixed
 * fixture of "detected fields" — they don't actually inspect the
 * live page. So when the helper renders only what the session
 * "detected", the user sees First Name + Last Name + Email + Phone
 * and missing Country / Location / LinkedIn / Visa / Eligibility /
 * "How did you hear about us" — every field a real Greenhouse form
 * actually shows.
 *
 * Fix: this helper now surfaces ALL candidate-side data the user has
 * in their profile (Location, LinkedIn, GitHub, Portfolio, Work
 * Authorization, etc.) regardless of whether the static detector
 * listed them. The user matches them up to the real form. Empty
 * profile fields surface as "missing" rows with an "Add to profile"
 * CTA so they're ready next time.
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

/**
 * A candidate-side field that's commonly required by application
 * forms but is empty in the user's profile. Surfaced with a CTA so
 * the user can fill it on the Profile setup page and have it ready
 * for the next application.
 */
export interface ManualApplyMissingField {
  label: string;
  /** Why this matters / what to enter (one-line guidance). */
  guidance: string;
  /** Profile-setup field id the user should fill. */
  profileField: string;
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
  /** Profile fields that are empty but commonly required by forms. */
  missingFields: ManualApplyMissingField[];
  /** Cover letter text (only when the package opted in). */
  coverLetter: string | null;
  /** Short answers (only when the package opted in). */
  shortAnswers: ManualApplyAnswer[];
  /** Items the assistant can't help with (CAPTCHA / Final submit / Gender). */
  pauseItems: ManualApplyPauseItem[];
  /**
   * Pre-formatted copy-all text. One click puts every field +
   * cover letter + short answers in the clipboard as a structured
   * block the user can scan while filling the form.
   */
  copyAllText: string;
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
 * Build the candidate-side field list. We surface EVERY profile
 * field that has a value, regardless of whether the session
 * "detected" it on the form, because the static dry-run adapter
 * is a fixture and most real forms have more fields than it
 * reports.
 *
 * Empty profile fields go into `missingFields` instead so the user
 * can pre-fill them in Profile setup.
 */
function buildProfileFieldRows(
  profile: UserProfile | null
): { fields: ManualApplyField[]; missing: ManualApplyMissingField[] } {
  const fields: ManualApplyField[] = [];
  const missing: ManualApplyMissingField[] = [];
  if (!profile) {
    return { fields, missing };
  }

  const push = (
    label: string,
    rawValue: string,
    profileField: string,
    guidance: string
  ): void => {
    const value = rawValue.trim();
    if (value.length > 0) {
      fields.push({ label, value, sourceLabel: "profile" });
    } else {
      missing.push({ label, guidance, profileField });
    }
  };

  const fullNameValue = profile.fullName.trim();
  if (fullNameValue.length > 0) {
    fields.push({
      label: "First Name",
      value: firstName(fullNameValue),
      sourceLabel: "profile"
    });
    fields.push({
      label: "Last Name",
      value: lastName(fullNameValue),
      sourceLabel: "profile"
    });
    fields.push({
      label: "Full Name",
      value: fullNameValue,
      sourceLabel: "profile"
    });
  } else {
    missing.push({
      label: "Name",
      guidance:
        "Most forms require First Name + Last Name as separate fields.",
      profileField: "fullName"
    });
  }

  push(
    "Email",
    profile.email,
    "email",
    "Required on virtually every job application."
  );
  push(
    "Phone",
    profile.phone,
    "phone",
    "Required on most application forms."
  );
  push(
    "Location",
    profile.location,
    "location",
    "City / state / country — Greenhouse and Lever ask this on most postings."
  );
  push(
    "LinkedIn URL",
    profile.linkedinUrl,
    "linkedinUrl",
    "Most engineering roles ask for a LinkedIn profile link."
  );
  push(
    "GitHub URL",
    profile.githubUrl,
    "githubUrl",
    "Most engineering roles ask for a GitHub or code-sample link."
  );
  push(
    "Portfolio / Website",
    profile.portfolioUrl,
    "portfolioUrl",
    "Optional but commonly asked, especially for design / PM / IC roles."
  );
  push(
    "Work Authorization",
    profile.workAuthorization,
    "workAuthorization",
    'Often asked as "Are you authorized to work in the U.S.?" or "Will you require visa sponsorship?"'
  );

  return { fields, missing };
}

/**
 * Map a session field-detected `id` → ManualApplyField using the
 * candidate's own profile/resume/answer data. Used for free-text
 * fields the LLM drafted (e.g. "What makes you a strong fit?")
 * that aren't in the standard profile-field set.
 *
 * Returns null when the source has nothing to fill — the UI hides
 * those rows rather than showing an empty value.
 */
function resolveFreeTextAnswerField(
  fieldLabel: string,
  answers: ApplicationAnswer[]
): ManualApplyField | null {
  const matchingAnswer = answers.find((answer) => {
    const normalizedQuestion = answer.question.toLowerCase();
    const normalizedLabel = fieldLabel.toLowerCase();
    return (
      normalizedQuestion === normalizedLabel ||
      normalizedQuestion.replace(/[^a-z0-9]+/g, " ").trim() ===
        normalizedLabel.replace(/[^a-z0-9]+/g, " ").trim()
    );
  });
  if (!matchingAnswer || matchingAnswer.answer.trim().length === 0) {
    return null;
  }
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

function buildCopyAllText(input: {
  jobLabel: string;
  jobUrl: string;
  resumeFileName: string | null;
  fields: ManualApplyField[];
  coverLetter: string | null;
  shortAnswers: ManualApplyAnswer[];
}): string {
  const sections: string[] = [];
  sections.push(`# ${input.jobLabel}`);
  if (input.jobUrl) sections.push(`Application URL: ${input.jobUrl}`);
  if (input.resumeFileName) {
    sections.push(`Resume to upload: ${input.resumeFileName}`);
  }
  if (input.fields.length > 0) {
    sections.push("");
    sections.push("## Your details");
    for (const field of input.fields) {
      sections.push(`${field.label}: ${field.value}`);
    }
  }
  if (input.coverLetter) {
    sections.push("");
    sections.push("## Cover letter");
    sections.push(input.coverLetter);
  }
  if (input.shortAnswers.length > 0) {
    sections.push("");
    sections.push("## Short answers");
    for (const qa of input.shortAnswers) {
      sections.push("");
      sections.push(`Q: ${qa.question}`);
      sections.push(`A: ${qa.answer}`);
    }
  }
  return sections.join("\n");
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

  // 1) ALL candidate-side profile fields with values, regardless of
  //    whether the static dry-run adapter "detected" them. Empty
  //    profile fields go into missingFields so the user can pre-fill
  //    them on the Profile setup page.
  const { fields: profileFields, missing } = buildProfileFieldRows(profile);

  // 2) Plus any additional free-text fields the session detected
  //    that match a saved short-answer (e.g. "What makes you a
  //    strong fit?"). These wouldn't show up in profile-field rows.
  const pauseFieldIds = new Set(
    session.uncertainFields.map((field) => field.fieldId)
  );
  const seenLabels = new Set(profileFields.map((f) => f.label.toLowerCase()));
  const extraFields: ManualApplyField[] = [];
  for (const detected of session.fieldsDetected) {
    if (pauseFieldIds.has(detected.id)) continue;
    if (seenLabels.has(detected.label.toLowerCase())) continue;
    if (detected.id === "resume" || detected.id === "cover_letter") continue;
    // Treat the detected field as a free-text answer slot.
    const resolved = resolveFreeTextAnswerField(detected.label, answers);
    if (resolved) {
      extraFields.push(resolved);
      seenLabels.add(resolved.label.toLowerCase());
    }
  }

  const fields = [...profileFields, ...extraFields];

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

  const jobLabel = `${job.title} at ${job.company}`;
  const resumeFileName = resume?.originalFileName ?? null;
  const copyAllText = buildCopyAllText({
    jobLabel,
    jobUrl: job.applicationUrl,
    resumeFileName,
    fields,
    coverLetter,
    shortAnswers
  });

  return {
    jobUrl: job.applicationUrl,
    jobLabel,
    resumeFileName,
    fields,
    missingFields: missing,
    coverLetter,
    shortAnswers,
    pauseItems,
    copyAllText
  };
}
