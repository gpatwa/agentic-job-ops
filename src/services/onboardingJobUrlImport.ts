import type {
  AppSession,
  AtsType,
  JobSource,
  NormalizedJob
} from "../models/domain";
import { normalizedJobSchema } from "../models/schemas";
import {
  loadNormalizedJobs,
  saveNormalizedJobs
} from "./jobIngestion";

/**
 * Phase 18 — Onboarding "paste a job URL" flow.
 *
 * Pure URL → NormalizedJob importer for the onboarding step. Lives
 * outside jobIngestion.ts so the existing manual-import path stays
 * unchanged and so this module can be unit-tested without dragging
 * in the full ingestion pipeline.
 *
 * Safety contract:
 * - Never logs the URL beyond what's already persisted on the
 *   NormalizedJob record (the URL itself is a domain field).
 * - Never reaches the network. Greenhouse / Lever detection is
 *   purely string-based; live enrichment is the job of a future
 *   server-side adapter and is intentionally not wired here.
 * - Idempotent: re-importing the same URL returns the existing
 *   record and reports `isDuplicate: true`.
 * - Manual overrides only ever fill placeholder fields ("Manually
 *   imported job", "Unknown company", "Unknown") so a real value
 *   from a previous import is never silently overwritten.
 */

export interface ParsedJobUrl {
  /** Job source enum value (matches NormalizedJob.source). */
  source: JobSource;
  /** ATS type enum value (matches NormalizedJob.atsType). */
  atsType: AtsType;
  /** Company slug from the URL when detectable (e.g. "afresh"). */
  companySlug: string | null;
  /** External job id from the URL when detectable. */
  externalJobId: string | null;
  /** The trimmed input URL (preserved verbatim for the record). */
  originalUrl: string;
  /** Lower-cased hostname extracted from the URL (best-effort). */
  detectedHostname: string;
}

export interface OnboardingJobImportOverrides {
  title?: string;
  company?: string;
  location?: string;
}

export interface OnboardingJobImportResult {
  /** The persisted NormalizedJob record. */
  job: NormalizedJob;
  /** What we detected from the URL string. */
  parsedUrl: ParsedJobUrl;
  /** True when an existing record was reused instead of created. */
  isDuplicate: boolean;
  /**
   * True when the resulting record still has placeholder title/company
   * (e.g. URL detection didn't yield enough metadata and the user
   * hasn't supplied overrides). The UI uses this to ask the user to
   * fill missing fields and to scope scoring confidence.
   */
  needsManualEnrichment: boolean;
}

const PLACEHOLDER_TITLE = "Imported job pending enrichment";
const PLACEHOLDER_COMPANY = "Unknown company";
const PLACEHOLDER_LOCATION = "Unknown";

const PLACEHOLDER_DESCRIPTION =
  "We detected this as an externally hosted job. Full job description is not available locally — add the missing details below or run enrichment later. Scoring confidence is limited until the description is filled in.";

function nowIso(): string {
  return new Date().toISOString();
}

function createId(prefix: string): string {
  return `${prefix}_${globalThis.crypto.randomUUID()}`;
}

function safeUrl(input: string): URL | null {
  try {
    return new URL(input.trim());
  } catch {
    return null;
  }
}

function normalizeOverride(value: string | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function titleCaseFromSlug(slug: string): string {
  return slug
    .split(/[-_]+/)
    .filter(Boolean)
    .map((piece) => piece.charAt(0).toUpperCase() + piece.slice(1))
    .join(" ");
}

/**
 * Detect ATS source + extract identifiers from a job URL.
 *
 * Greenhouse:
 *   - https://job-boards.greenhouse.io/{company}/jobs/{id}
 *   - https://boards.greenhouse.io/{company}/jobs/{id}
 *
 * Lever:
 *   - https://jobs.lever.co/{company}/{id}
 *   - https://jobs.lever.co/{company}
 *
 * Anything else falls back to `source: "manual"` with hostname
 * captured for the UI's "we detected this as a generic URL" copy.
 */
export function parseJobUrlForImport(input: string): ParsedJobUrl {
  const originalUrl = input.trim();
  const parsed = safeUrl(originalUrl);
  if (!parsed) {
    return {
      source: "manual",
      atsType: "manual",
      companySlug: null,
      externalJobId: null,
      originalUrl,
      detectedHostname: ""
    };
  }

  const hostname = parsed.hostname.toLowerCase();
  const segments = parsed.pathname.split("/").filter(Boolean);

  if (
    hostname === "job-boards.greenhouse.io" ||
    hostname === "boards.greenhouse.io" ||
    hostname.endsWith(".greenhouse.io")
  ) {
    // Expected: /{company}/jobs/{id}
    const company = segments[0] ?? null;
    const jobsIndex = segments.indexOf("jobs");
    const externalJobId =
      jobsIndex >= 0 && segments[jobsIndex + 1] ? segments[jobsIndex + 1] : null;
    return {
      source: "greenhouse",
      atsType: "greenhouse",
      companySlug: company,
      externalJobId,
      originalUrl,
      detectedHostname: hostname
    };
  }

  if (
    hostname === "jobs.lever.co" ||
    hostname === "lever.co" ||
    hostname.endsWith(".lever.co")
  ) {
    // Expected: /{company}/{id?}
    const company = segments[0] ?? null;
    const externalJobId = segments[1] ?? null;
    return {
      source: "lever",
      atsType: "lever",
      companySlug: company,
      externalJobId,
      originalUrl,
      detectedHostname: hostname
    };
  }

  return {
    source: "manual",
    atsType: "manual",
    companySlug: null,
    externalJobId: null,
    originalUrl,
    detectedHostname: hostname
  };
}

/**
 * Build the sourceJobId used for dedupe. Prefer source+externalJobId
 * when known so the same Greenhouse posting always collapses to one
 * record, even if the URL gains/loses query parameters.
 */
function dedupeKeyFor(parsed: ParsedJobUrl): string {
  if (parsed.externalJobId && parsed.companySlug) {
    return `${parsed.source}:${parsed.companySlug}:${parsed.externalJobId}`;
  }
  return parsed.originalUrl;
}

function findExistingJob(
  session: AppSession,
  parsed: ParsedJobUrl
): NormalizedJob | null {
  const key = dedupeKeyFor(parsed);
  const all = loadNormalizedJobs(session);
  return (
    all.find(
      (job) =>
        job.source === parsed.source &&
        job.sourceJobId === key
    ) ??
    all.find((job) => job.applicationUrl === parsed.originalUrl) ??
    null
  );
}

/**
 * Returns true if the field is still the placeholder value we wrote
 * during import (i.e. the user has NOT filled in real data yet). The
 * import pass uses this to decide which fields a manual-override
 * call is allowed to overwrite — we never silently replace a real
 * value the user (or a prior enrichment) has already saved.
 */
function isPlaceholder(field: "title" | "company" | "location", value: string): boolean {
  if (field === "title") return value.trim() === PLACEHOLDER_TITLE;
  if (field === "company") return value.trim() === PLACEHOLDER_COMPANY;
  return value.trim() === PLACEHOLDER_LOCATION;
}

function applyOverridesToJob(
  job: NormalizedJob,
  overrides: OnboardingJobImportOverrides
): NormalizedJob {
  const title = normalizeOverride(overrides.title);
  const company = normalizeOverride(overrides.company);
  const location = normalizeOverride(overrides.location);
  const next = {
    ...job,
    title: title && isPlaceholder("title", job.title) ? title : job.title,
    company:
      company && isPlaceholder("company", job.company) ? company : job.company,
    location:
      location && isPlaceholder("location", job.location)
        ? location
        : job.location,
    updatedAt: nowIso()
  };
  return normalizedJobSchema.parse(next);
}

function buildNewJob(
  session: AppSession,
  parsed: ParsedJobUrl,
  overrides: OnboardingJobImportOverrides
): NormalizedJob {
  const timestamp = nowIso();
  const slugTitle = parsed.companySlug
    ? `${titleCaseFromSlug(parsed.companySlug)} role`
    : null;
  const fallbackCompany = parsed.companySlug
    ? titleCaseFromSlug(parsed.companySlug)
    : PLACEHOLDER_COMPANY;
  const title = normalizeOverride(overrides.title) ?? PLACEHOLDER_TITLE;
  const company = normalizeOverride(overrides.company) ?? fallbackCompany;
  const location = normalizeOverride(overrides.location) ?? PLACEHOLDER_LOCATION;
  return normalizedJobSchema.parse({
    id: createId("job"),
    tenantId: session.tenant.id,
    userId: session.userId,
    sourceConfigId: null,
    source: parsed.source,
    sourceJobId: dedupeKeyFor(parsed),
    title,
    company,
    location,
    remoteType: "unknown",
    salaryMin: null,
    salaryMax: null,
    description: PLACEHOLDER_DESCRIPTION,
    responsibilities: [],
    requirements: [],
    applicationUrl: parsed.originalUrl,
    atsType: parsed.atsType,
    postedAt: null,
    discoveredAt: timestamp,
    scoringStatus: "queued",
    createdAt: timestamp,
    updatedAt: timestamp,
    // Internal narrative used only when we managed to derive a slug-
    // based title. Kept on the description so scoring still has SOME
    // signal but stays clearly placeholder.
    ...(slugTitle && title === PLACEHOLDER_TITLE ? {} : {})
  });
}

/**
 * Import a job from a pasted URL during onboarding. Idempotent:
 * re-importing the same URL returns the existing record (with any
 * supplied overrides applied to placeholder fields) and reports
 * `isDuplicate: true`.
 */
export function importOnboardingJobFromUrl(
  session: AppSession,
  url: string,
  overrides: OnboardingJobImportOverrides = {}
): OnboardingJobImportResult {
  const trimmed = url.trim();
  if (trimmed.length === 0) {
    throw new Error("Paste a job URL to import.");
  }
  const parsed = parseJobUrlForImport(trimmed);

  const existing = findExistingJob(session, parsed);
  if (existing) {
    const updated = applyOverridesToJob(existing, overrides);
    const all = loadNormalizedJobs(session).map((job) =>
      job.id === updated.id ? updated : job
    );
    saveNormalizedJobs(session, all);
    return {
      job: updated,
      parsedUrl: parsed,
      isDuplicate: true,
      needsManualEnrichment: jobNeedsManualEnrichment(updated)
    };
  }

  const newJob = buildNewJob(session, parsed, overrides);
  saveNormalizedJobs(session, [newJob, ...loadNormalizedJobs(session)]);
  return {
    job: newJob,
    parsedUrl: parsed,
    isDuplicate: false,
    needsManualEnrichment: jobNeedsManualEnrichment(newJob)
  };
}

/**
 * Replace placeholder title/company/location on an already-imported
 * job. Used by the "Apply manual details" button when the user fills
 * in the missing fields after import.
 */
export function applyManualJobOverrides(
  session: AppSession,
  jobId: string,
  overrides: OnboardingJobImportOverrides
): NormalizedJob {
  const all = loadNormalizedJobs(session);
  const target = all.find((job) => job.id === jobId);
  if (!target) {
    throw new Error("Imported job was not found in the local store.");
  }
  const updated = applyOverridesToJob(target, overrides);
  saveNormalizedJobs(
    session,
    all.map((job) => (job.id === updated.id ? updated : job))
  );
  return updated;
}

/**
 * True when the job's title/company/location are still the import-
 * time placeholders. The UI uses this to ask the user for missing
 * data and to surface a low-confidence scoring caveat.
 */
export function jobNeedsManualEnrichment(job: NormalizedJob): boolean {
  return (
    isPlaceholder("title", job.title) ||
    isPlaceholder("company", job.company) ||
    isPlaceholder("location", job.location) ||
    job.description.trim() === PLACEHOLDER_DESCRIPTION.trim()
  );
}

export const ONBOARDING_JOB_URL_PLACEHOLDERS = {
  title: PLACEHOLDER_TITLE,
  company: PLACEHOLDER_COMPANY,
  location: PLACEHOLDER_LOCATION,
  description: PLACEHOLDER_DESCRIPTION
} as const;
