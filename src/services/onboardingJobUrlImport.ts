import type {
  AppSession,
  AtsType,
  JobSource,
  NormalizedJob
} from "../models/domain";
import { normalizedJobSchema } from "../models/schemas";
import {
  detectRemoteType,
  extractSectionLines,
  loadNormalizedJobs,
  saveNormalizedJobs,
  stripHtml
} from "./jobIngestion";

/**
 * Phase 18 — Onboarding "paste a job URL" flow.
 *
 * Two-stage importer for the onboarding step:
 * 1) `importOnboardingJobFromUrl` — synchronous, network-free.
 *    Parses the URL, creates a placeholder NormalizedJob so the UI
 *    can show something instantly. Idempotent on (source, slug, id).
 * 2) `enrichOnboardingImportedJob` — async, calls the public ATS
 *    API (Greenhouse `/v1/boards/{slug}/jobs/{id}` or Lever
 *    `/v0/postings/{slug}/{id}`) to replace placeholder fields
 *    (title, company, location, description, requirements,
 *    responsibilities, postedAt, remoteType) with real data.
 *    Both endpoints expose Access-Control-Allow-Origin: *, so the
 *    call works browser-direct without a proxy.
 *
 * Safety contract:
 * - Never logs the URL beyond what's already persisted on the
 *   NormalizedJob record (the URL itself is a domain field).
 * - Enrichment is best-effort. Network failure / non-2xx leaves
 *   the placeholder intact so the manual-override UI still works;
 *   the function never throws on a failed fetch.
 * - Idempotent: re-importing the same URL returns the existing
 *   record and reports `isDuplicate: true`.
 * - Manual overrides only ever fill placeholder fields so a real
 *   value from a previous import or enrichment is never silently
 *   overwritten.
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

// ---------------------------------------------------------------------------
// Async live enrichment via public ATS APIs
// ---------------------------------------------------------------------------

const ENRICHMENT_TIMEOUT_MS = 15_000;

export interface EnrichmentResult {
  /** The job after enrichment (or the unchanged placeholder on failure). */
  job: NormalizedJob;
  /** True iff at least one placeholder field was replaced with real data. */
  enriched: boolean;
  /**
   * Categorised failure reason when `enriched === false`. `null` means
   * enrichment succeeded OR there was nothing to enrich (the job was
   * already populated by a prior pass).
   */
  failureReason:
    | null
    | "url_missing_slug_or_id"
    | "unsupported_source"
    | "network"
    | "timeout"
    | "http_4xx"
    | "http_5xx"
    | "json_parse"
    | "empty_response";
}

interface GreenhouseSingleJobResponse {
  id?: number;
  title?: string;
  content?: string;
  location?: { name?: string };
  absolute_url?: string;
  updated_at?: string;
  first_published?: string;
  company_name?: string;
}

interface LeverSinglePostingResponse {
  id?: string;
  text?: string;
  description?: string;
  additional?: string;
  categories?: {
    team?: string;
    location?: string;
    commitment?: string;
  };
  hostedUrl?: string;
  applyUrl?: string;
  createdAt?: number;
  workplaceType?: "remote" | "hybrid" | "on-site";
  lists?: Array<{ text?: string; content?: string }>;
}

function categoriseHttpStatus(
  status: number
): "http_4xx" | "http_5xx" {
  return status >= 500 ? "http_5xx" : "http_4xx";
}

async function fetchWithTimeout(
  url: string,
  fetcher: typeof fetch
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ENRICHMENT_TIMEOUT_MS);
  try {
    return await fetcher(url, {
      headers: { Accept: "application/json" },
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Build the patch fields for a Greenhouse single-job response. Pure
 * mapper — no I/O, no localStorage. Returns `null` when the response
 * is too sparse to be useful.
 */
export function mapGreenhouseSingleJobResponse(
  payload: GreenhouseSingleJobResponse,
  parsed: ParsedJobUrl
): Partial<NormalizedJob> | null {
  const title = (payload.title ?? "").trim();
  if (!title) return null;
  const description = stripHtml(payload.content);
  const locationName = (payload.location?.name ?? "").trim();
  const company =
    (payload.company_name ?? "").trim() ||
    (parsed.companySlug ? titleCaseFromSlug(parsed.companySlug) : "");
  return {
    title,
    company: company || PLACEHOLDER_COMPANY,
    location: locationName || PLACEHOLDER_LOCATION,
    remoteType: detectRemoteType(locationName, description),
    description,
    responsibilities: extractSectionLines(description, [
      "responsibil",
      "what you will do",
      "what you'll do"
    ]),
    requirements: extractSectionLines(description, [
      "requirement",
      "qualification",
      "what you bring"
    ]),
    applicationUrl: payload.absolute_url?.trim() || parsed.originalUrl,
    postedAt: payload.first_published || payload.updated_at || null
  };
}

/**
 * Build the patch fields for a Lever single-posting response. The
 * description is split across `description`, `additional`, and the
 * `lists` array; we concatenate after stripping each chunk so the
 * EMPLOYER IS LOOKING FOR / requirements extraction sees the full
 * text.
 */
export function mapLeverSinglePostingResponse(
  payload: LeverSinglePostingResponse,
  parsed: ParsedJobUrl
): Partial<NormalizedJob> | null {
  const title = (payload.text ?? "").trim();
  if (!title) return null;
  const descriptionParts = [
    stripHtml(payload.description),
    ...(payload.lists ?? []).flatMap((list) => [
      list.text ? `\n${list.text}\n` : "",
      stripHtml(list.content)
    ]),
    stripHtml(payload.additional)
  ].filter(Boolean);
  const description = descriptionParts.join("\n").trim();
  const locationName = (payload.categories?.location ?? "").trim();
  const company = parsed.companySlug
    ? titleCaseFromSlug(parsed.companySlug)
    : "";
  return {
    title,
    company: company || PLACEHOLDER_COMPANY,
    location: locationName || PLACEHOLDER_LOCATION,
    remoteType: detectRemoteType(
      locationName,
      description,
      payload.workplaceType
    ),
    description,
    responsibilities: extractSectionLines(description, [
      "responsibil",
      "what you will do",
      "what you'll do"
    ]),
    requirements: extractSectionLines(description, [
      "requirement",
      "qualification",
      "what you bring"
    ]),
    applicationUrl:
      payload.applyUrl?.trim() ||
      payload.hostedUrl?.trim() ||
      parsed.originalUrl,
    postedAt:
      typeof payload.createdAt === "number"
        ? new Date(payload.createdAt).toISOString()
        : null
  };
}

/**
 * Live-enrich an imported job by calling the public ATS API for the
 * pasted URL's source. Best-effort: any failure leaves the
 * placeholder intact and surfaces the reason in `failureReason`.
 *
 * Network calls go directly from the browser; both Greenhouse
 * (`boards-api.greenhouse.io`) and Lever (`api.lever.co`) expose
 * `Access-Control-Allow-Origin: *`, which is the same property the
 * curated catalog discovery slice relies on.
 */
export async function enrichOnboardingImportedJob(
  session: AppSession,
  jobId: string,
  fetcher: typeof fetch = fetch
): Promise<EnrichmentResult> {
  const all = loadNormalizedJobs(session);
  const target = all.find((job) => job.id === jobId);
  if (!target) {
    throw new Error("Imported job was not found in the local store.");
  }

  // No-op early when the job already has real data (e.g. user
  // navigated away and re-imported the same URL after enrichment
  // already ran). Avoids a redundant network call.
  if (!jobNeedsManualEnrichment(target)) {
    return { job: target, enriched: false, failureReason: null };
  }

  const parsed = parseJobUrlForImport(target.applicationUrl);
  if (!parsed.companySlug || !parsed.externalJobId) {
    return {
      job: target,
      enriched: false,
      failureReason: "url_missing_slug_or_id"
    };
  }

  let endpoint: string | null = null;
  if (parsed.source === "greenhouse") {
    endpoint = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(
      parsed.companySlug
    )}/jobs/${encodeURIComponent(parsed.externalJobId)}?content=true`;
  } else if (parsed.source === "lever") {
    endpoint = `https://api.lever.co/v0/postings/${encodeURIComponent(
      parsed.companySlug
    )}/${encodeURIComponent(parsed.externalJobId)}?mode=json`;
  } else {
    return {
      job: target,
      enriched: false,
      failureReason: "unsupported_source"
    };
  }

  let response: Response;
  try {
    response = await fetchWithTimeout(endpoint, fetcher);
  } catch (error) {
    const aborted =
      error instanceof DOMException && error.name === "AbortError";
    return {
      job: target,
      enriched: false,
      failureReason: aborted ? "timeout" : "network"
    };
  }

  if (!response.ok) {
    return {
      job: target,
      enriched: false,
      failureReason: categoriseHttpStatus(response.status)
    };
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return { job: target, enriched: false, failureReason: "json_parse" };
  }

  const patch =
    parsed.source === "greenhouse"
      ? mapGreenhouseSingleJobResponse(
          payload as GreenhouseSingleJobResponse,
          parsed
        )
      : mapLeverSinglePostingResponse(
          payload as LeverSinglePostingResponse,
          parsed
        );

  if (!patch) {
    return { job: target, enriched: false, failureReason: "empty_response" };
  }

  const enrichedJob = normalizedJobSchema.parse({
    ...target,
    ...patch,
    updatedAt: nowIso()
  });
  saveNormalizedJobs(
    session,
    all.map((job) => (job.id === enrichedJob.id ? enrichedJob : job))
  );
  return { job: enrichedJob, enriched: true, failureReason: null };
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
