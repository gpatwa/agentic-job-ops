/**
 * Structured diagnostic returned by /api/resume/parse.
 *
 * The diagnostic is the contract between the parser and the
 * onboarding UI: it tells the user (and the resume-intelligence
 * gate) whether we got enough text to safely run analysis, what
 * went wrong if not, and the smallest action that recovers.
 *
 * Hard rule: this object NEVER carries the raw resume text. The
 * extracted text is returned alongside it in the route response,
 * but the diagnostic itself is metadata-only and safe to log /
 * surface to operators in Admin/System.
 */

export type ParseStatus = "good" | "partial" | "poor" | "unreadable";

export type ParseExtractedFrom =
  | "txt"
  | "md"
  | "pdf"
  | "docx"
  | "doc"
  | "unknown";

export type ParseIssueType =
  | "ok"
  | "scanned_or_image_pdf"
  | "too_little_text"
  | "unsupported_doc_format"
  | "unsupported_file_type"
  | "decode_failed"
  | "file_too_large"
  | "empty_file";

export interface ParseSignals {
  hasEmail: boolean;
  hasPhone: boolean;
  hasLikelyName: boolean;
  hasRoleTitle: boolean;
  hasCompany: boolean;
  hasDates: boolean;
  hasSkills: boolean;
}

export interface ParseDiagnostic {
  status: ParseStatus;
  issueType: ParseIssueType;
  characterCount: number;
  extractedFrom: ParseExtractedFrom;
  signalsDetected: ParseSignals;
  /** Operator-facing hypothesis (e.g. "scanned PDF"). */
  likelyCause: string;
  /** Customer-friendly one-liner. */
  userExplanation: string;
  /** The single next action the user should take. */
  recommendedFix: string;
  /** True when text quality is good/partial — safe to run full intelligence. */
  canRunIntelligence: boolean;
  /**
   * True when text is partial but still usable. The UI uses this
   * to show "limited analysis" copy instead of blocking entirely.
   */
  canRunLimitedAnalysis: boolean;
}

const NO_SIGNALS: ParseSignals = {
  hasEmail: false,
  hasPhone: false,
  hasLikelyName: false,
  hasRoleTitle: false,
  hasCompany: false,
  hasDates: false,
  hasSkills: false
};

export function emptySignals(): ParseSignals {
  return { ...NO_SIGNALS };
}

/**
 * Pure, server-side signal detection. Mirrors the heuristics used
 * by the existing `assessResumeTextQuality` (frontend) so the gate
 * decision is consistent across server and browser. Kept as a
 * sibling implementation rather than a shared import to avoid
 * coupling the server's `server/parsing/` module to the React
 * service layer in `src/services/`.
 */
export function detectParseSignals(text: string): ParseSignals {
  if (!text || text.length === 0) return emptySignals();

  const hasEmail = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(text);

  let hasPhone = false;
  const phoneMatch = text.match(/\+?\d[\d\s().-]{8,}\d/);
  if (phoneMatch) {
    const trimmed = phoneMatch[0].trim();
    const isYearRange = /^\d{4}\s*[-–]\s*\d{4}$/.test(trimmed);
    const digits = trimmed.replace(/[^0-9]/g, "");
    hasPhone = !isYearRange && digits.length >= 10 && digits.length <= 15;
  }

  const hasLikelyName = detectName(text);
  const hasRoleTitle =
    /\b(manager|engineer|designer|analyst|scientist|director|lead|specialist|recruiter|architect|consultant|product|developer)\b/i.test(
      text
    );
  const hasCompany =
    /\bat\s+[A-Z][A-Za-z0-9&. -]{2,}/.test(text) ||
    /[—–-]\s*[A-Z][A-Za-z0-9&. ]{2,}/.test(text);
  const hasDates = /(\d{4})\s*[–-]\s*(\d{4}|present|current)/i.test(text);
  const hasSkills =
    /^\s*skills\s*$/im.test(text) ||
    /\bskills:?\s*\n/i.test(text) ||
    /\b(tools|technologies)\b/i.test(text);

  return {
    hasEmail,
    hasPhone,
    hasLikelyName,
    hasRoleTitle,
    hasCompany,
    hasDates,
    hasSkills
  };
}

function detectName(text: string): boolean {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  for (const line of lines.slice(0, 5)) {
    if (line.length > 60 || line.includes("@") || /\d/.test(line)) continue;
    const words = line.split(/\s+/);
    if (words.length < 2 || words.length > 5) continue;
    if (words.every((word) => /^[A-Z][a-zA-Z'\-]+$/.test(word))) {
      return true;
    }
  }
  return false;
}

/**
 * Decide the band based on signal count + text length. Pure
 * helper used by both the success path and the "tiny text"
 * fallback in the parser.
 */
export function classifyExtractedText(
  text: string,
  source: ParseExtractedFrom
): ParseDiagnostic {
  const characterCount = text.length;
  if (characterCount === 0) {
    return buildDiagnostic({
      status: "unreadable",
      issueType: "empty_file",
      characterCount,
      extractedFrom: source,
      signals: emptySignals(),
      likelyCause: "Decoded text was empty.",
      userExplanation:
        "We could not read any text from this file.",
      recommendedFix:
        source === "pdf" || source === "docx" || source === "doc"
          ? "Paste your resume text or upload a TXT/MD copy."
          : "Paste your resume text below to start analysis."
    });
  }

  const signals = detectParseSignals(text);
  const signalCount = Object.values(signals).filter(Boolean).length;

  if (characterCount < 80 || signalCount === 0) {
    const issueType: ParseIssueType =
      source === "pdf" ? "scanned_or_image_pdf" : "too_little_text";
    const likelyCause =
      source === "pdf"
        ? "PDF appears to be scanned or image-based — no selectable text was found."
        : "Decoded text is too short to analyse.";
    return buildDiagnostic({
      status: "unreadable",
      issueType,
      characterCount,
      extractedFrom: source,
      signals,
      likelyCause,
      userExplanation:
        source === "pdf"
          ? "We couldn't read text from this PDF. It looks scanned or image-based; OCR is not enabled in this build."
          : "We couldn't read enough text from this file to analyse it.",
      recommendedFix:
        "Paste your resume text below, or upload a text-based copy (TXT, MD, or a PDF exported from a word processor)."
    });
  }

  let status: ParseStatus;
  if (signalCount >= 5) status = "good";
  else if (signalCount >= 3) status = "partial";
  else status = "poor";

  if (status === "good") {
    return buildDiagnostic({
      status,
      issueType: "ok",
      characterCount,
      extractedFrom: source,
      signals,
      likelyCause: "Resume text extracted successfully.",
      userExplanation: "Resume text quality is good. You can run analysis.",
      recommendedFix: ""
    });
  }
  if (status === "partial") {
    return buildDiagnostic({
      status,
      issueType: "ok",
      characterCount,
      extractedFrom: source,
      signals,
      likelyCause:
        "Some structural signals are missing (name, email, dates, role).",
      userExplanation:
        "Resume text quality is partial. Analysis will run with limited confidence — confirm uncertain fields before applying.",
      recommendedFix:
        "Add the missing details (name, email, role, dates) to the source file or paste a fuller version."
    });
  }
  // poor
  return buildDiagnostic({
    status,
    issueType: "too_little_text",
    characterCount,
    extractedFrom: source,
    signals,
    likelyCause:
      "Very few resume signals were detected even though some text was found.",
    userExplanation:
      "We could only detect a few resume signals. Analysis would be unreliable.",
    recommendedFix:
      "Paste a fuller version of your resume, or upload a TXT/MD copy."
  });
}

function buildDiagnostic(input: {
  status: ParseStatus;
  issueType: ParseIssueType;
  characterCount: number;
  extractedFrom: ParseExtractedFrom;
  signals: ParseSignals;
  likelyCause: string;
  userExplanation: string;
  recommendedFix: string;
}): ParseDiagnostic {
  const canRunIntelligence =
    input.status === "good" || input.status === "partial";
  const canRunLimitedAnalysis = input.status === "partial";
  return {
    status: input.status,
    issueType: input.issueType,
    characterCount: input.characterCount,
    extractedFrom: input.extractedFrom,
    signalsDetected: input.signals,
    likelyCause: input.likelyCause,
    userExplanation: input.userExplanation,
    recommendedFix: input.recommendedFix,
    canRunIntelligence,
    canRunLimitedAnalysis
  };
}

/**
 * Build a diagnostic for a hard error (file too large, decode
 * failed, unsupported format) — i.e. paths where we never even
 * tried to extract text.
 */
export function buildErrorDiagnostic(
  issueType: ParseIssueType,
  source: ParseExtractedFrom,
  overrides: { likelyCause?: string; userExplanation?: string; recommendedFix?: string } = {}
): ParseDiagnostic {
  const defaults = errorDefaults(issueType, source);
  return buildDiagnostic({
    status: "unreadable",
    issueType,
    characterCount: 0,
    extractedFrom: source,
    signals: emptySignals(),
    likelyCause: overrides.likelyCause ?? defaults.likelyCause,
    userExplanation: overrides.userExplanation ?? defaults.userExplanation,
    recommendedFix: overrides.recommendedFix ?? defaults.recommendedFix
  });
}

function errorDefaults(issueType: ParseIssueType, source: ParseExtractedFrom): {
  likelyCause: string;
  userExplanation: string;
  recommendedFix: string;
} {
  switch (issueType) {
    case "unsupported_doc_format":
      return {
        likelyCause: "Legacy .doc files are not supported by the parser.",
        userExplanation:
          "We don't support legacy .doc files yet. Please save the resume as a .docx, .pdf, .txt, or .md file and upload again.",
        recommendedFix:
          "Save the resume as DOCX (or export as PDF / TXT / MD) and upload again."
      };
    case "unsupported_file_type":
      return {
        likelyCause: `Unsupported file type for source ${source}.`,
        userExplanation:
          "This file type is not supported. Use PDF, DOCX, TXT, or MD.",
        recommendedFix: "Upload a PDF, DOCX, TXT, or MD copy of the resume."
      };
    case "scanned_or_image_pdf":
      return {
        likelyCause:
          "PDF appears to be scanned or image-based — no selectable text was found.",
        userExplanation:
          "We couldn't read text from this PDF. It looks scanned or image-based; OCR is not enabled in this build.",
        recommendedFix:
          "Paste your resume text below, or upload a text-based PDF / DOCX / TXT / MD copy."
      };
    case "decode_failed":
      return {
        likelyCause: "The parser could not decode this file.",
        userExplanation:
          "We couldn't read this file. It may be corrupted or password-protected.",
        recommendedFix:
          "Try a different file format, or paste the resume text directly."
      };
    case "file_too_large":
      return {
        likelyCause: "File exceeds the maximum upload size.",
        userExplanation:
          "This file is too large to process. The current limit is 5 MB.",
        recommendedFix: "Upload a smaller file (under 5 MB)."
      };
    case "empty_file":
      return {
        likelyCause: "Decoded file payload was empty.",
        userExplanation: "We received an empty file.",
        recommendedFix: "Pick a non-empty resume file and try again."
      };
    case "too_little_text":
      return {
        likelyCause: "Extracted text was too short to analyse.",
        userExplanation:
          "We couldn't read enough text from this file to analyse it.",
        recommendedFix:
          "Paste a fuller version of your resume, or upload a TXT/MD copy."
      };
    case "ok":
    default:
      return {
        likelyCause: "Resume text extracted successfully.",
        userExplanation: "Resume text quality is good.",
        recommendedFix: ""
      };
  }
}
