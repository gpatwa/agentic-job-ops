import type { Resume } from "../models/domain";

/**
 * Resume text quality model.
 *
 * Bridges the gap between "we have a Resume record" and "we have
 * enough text to run a useful analysis". The deterministic + LLM
 * adapters both produce confident-looking output even when fed
 * placeholder text (e.g. a PDF whose binary content we never
 * extracted), which previously surfaced 100/100 ATS risk and zero
 * skills as a "real" analysis. The quality assessment lets the UI
 * gate the analyse path and surface a clear next-step instead.
 */

export type ResumeTextQualityStatus =
  | "good"
  | "partial"
  | "poor"
  | "unreadable";

export type ResumeTextSource =
  | "txt"
  | "md"
  | "pdf"
  | "docx"
  | "doc"
  | "pasted"
  | "demo"
  | "unknown";

export interface ResumeTextSignals {
  hasEmail: boolean;
  hasPhone: boolean;
  hasLikelyName: boolean;
  hasRoleTitle: boolean;
  hasCompany: boolean;
  hasDates: boolean;
  hasSkills: boolean;
}

export interface ResumeTextQuality {
  status: ResumeTextQualityStatus;
  characterCount: number;
  extractedFrom: ResumeTextSource;
  signalsDetected: ResumeTextSignals;
  /** Short human-readable warnings to surface in the UI / diagnostics. */
  warnings: string[];
  /**
   * One-line recommended fix for the user. Null when quality is
   * already good. The UI uses this verbatim in the parsing-issue
   * card so the wording stays consistent.
   */
  recommendedFix: string | null;
}

/**
 * Stable prefix written by the upload + extraction-pending paths
 * (see `parseUploadedResumeFile` and `createResumeUpload` in
 * resumeService.ts). Used as the "no usable text" signal.
 */
export const RESUME_EXTRACTION_PENDING_PREFIX =
  "Resume text extraction has not run yet";

const NO_SIGNALS: ResumeTextSignals = {
  hasEmail: false,
  hasPhone: false,
  hasLikelyName: false,
  hasRoleTitle: false,
  hasCompany: false,
  hasDates: false,
  hasSkills: false
};

function inferExtractionSource(resume: Resume): ResumeTextSource {
  // Demo wins over pasted: the seed flow uses createResumeFromText
  // (which stamps a local-paste:// URL), so checking URL first
  // would mis-classify the demo resume as "pasted".
  if (resume.originalFileName === "demo-resume.txt") return "demo";
  if (resume.fileUrl.startsWith("local-paste://")) return "pasted";
  const pieces = resume.originalFileName.toLowerCase().split(".");
  const ext = pieces.length > 1 ? pieces[pieces.length - 1] : "";
  if (ext === "txt") return "txt";
  if (ext === "md") return "md";
  if (ext === "pdf") return "pdf";
  if (ext === "docx") return "docx";
  if (ext === "doc") return "doc";
  return "unknown";
}

function detectSignals(text: string): ResumeTextSignals {
  if (text.length === 0) return { ...NO_SIGNALS };

  const hasEmail = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(text);
  // Phone: ≥10 digits with separators, but not a year range like "2022 - 2026".
  const phoneMatch = text.match(/\+?\d[\d\s().-]{8,}\d/);
  let hasPhone = false;
  if (phoneMatch) {
    const trimmed = phoneMatch[0].trim();
    const isYearRange = /^\d{4}\s*[-–]\s*\d{4}$/.test(trimmed);
    const digits = trimmed.replace(/[^0-9]/g, "");
    hasPhone =
      !isYearRange && digits.length >= 10 && digits.length <= 15;
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
  // Look for a likely full name in the first 5 non-empty lines:
  // 2-5 capitalised tokens, no digits, no @ symbol, ≤60 chars.
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

function pickFix(
  source: ResumeTextSource,
  status: ResumeTextQualityStatus
): string | null {
  if (status === "good") return null;
  if (source === "pdf" || source === "docx" || source === "doc") {
    return "We couldn't extract enough text from this file locally. Paste your resume text below, or upload a TXT/MD copy.";
  }
  if (status === "unreadable") {
    return "Paste your resume text to start analysis.";
  }
  if (status === "poor") {
    return "We could only detect a few resume signals. Paste a longer version, or upload a TXT/MD copy.";
  }
  // partial
  return "Some resume signals are missing. Add the missing details (name, email, role, dates) or replace the file for stronger analysis.";
}

/**
 * Assess the quality of a Resume's text payload. Pure function.
 *
 * Bands:
 *   - "unreadable" → either the placeholder pending-text (PDF/DOCX
 *     upload that we never parsed), an empty string, fewer than 50
 *     characters, OR zero signals detected.
 *   - "poor"       → 1-2 signals detected.
 *   - "partial"    → 3-4 signals detected.
 *   - "good"       → 5+ signals detected.
 */
export function assessResumeTextQuality(resume: Resume): ResumeTextQuality {
  const text = (resume.parsedText ?? "").trim();
  const characterCount = text.length;
  const extractedFrom = inferExtractionSource(resume);

  // Hard "unreadable" branch first — placeholder text or near-empty
  // input means we have nothing useful to analyse, regardless of
  // signals that might match by accident.
  if (
    characterCount === 0 ||
    text.startsWith(RESUME_EXTRACTION_PENDING_PREFIX) ||
    characterCount < 50
  ) {
    const warnings: string[] = [];
    if (text.startsWith(RESUME_EXTRACTION_PENDING_PREFIX)) {
      warnings.push("Text extraction has not run for this file yet.");
    } else if (characterCount === 0) {
      warnings.push("Resume text is empty.");
    } else {
      warnings.push("Resume text is too short to analyse.");
    }
    return {
      status: "unreadable",
      characterCount,
      extractedFrom,
      signalsDetected: { ...NO_SIGNALS },
      warnings,
      recommendedFix: pickFix(extractedFrom, "unreadable")
    };
  }

  const signals = detectSignals(text);
  const signalCount = Object.values(signals).filter(Boolean).length;

  let status: ResumeTextQualityStatus;
  if (signalCount >= 5) status = "good";
  else if (signalCount >= 3) status = "partial";
  else if (signalCount >= 1) status = "poor";
  else status = "unreadable";

  const warnings: string[] = [];
  if (!signals.hasEmail) warnings.push("No email detected.");
  if (!signals.hasPhone) warnings.push("No phone number detected.");
  if (!signals.hasLikelyName) warnings.push("No clear name at the top.");
  if (!signals.hasRoleTitle) warnings.push("No recognisable role title.");
  if (!signals.hasDates) warnings.push("No employment dates detected.");

  return {
    status,
    characterCount,
    extractedFrom,
    signalsDetected: signals,
    warnings,
    recommendedFix: pickFix(extractedFrom, status)
  };
}

/**
 * True when the quality is high enough to safely run the resume
 * intelligence pipeline. The UI uses this to gate the "Analyze
 * resume" CTA and the service uses it as a defense-in-depth check.
 */
export function canRunResumeIntelligence(quality: ResumeTextQuality): boolean {
  return quality.status === "good" || quality.status === "partial";
}

/**
 * Short, customer-facing label for the quality status. Used in the
 * onboarding header pill. Intentionally avoids any provider/model
 * detail — see docs/AI_SERVICE_ARCHITECTURE.md for why those live
 * in Admin/System only.
 */
export function describeResumeQualityForCustomer(
  quality: ResumeTextQuality
): string {
  switch (quality.status) {
    case "good":
      return "Resume text quality: Good";
    case "partial":
      return "Resume text quality: Partial";
    case "poor":
      return "Resume text quality: Poor";
    case "unreadable":
    default:
      return "Resume text quality: Unreadable";
  }
}
