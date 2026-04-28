import type {
  AppSession,
  JobSourceConfig,
  JobTargetRecommendation
} from "../models/domain";
import {
  CURATED_COMPANY_CATALOG,
  pickCuratedCompaniesForResume,
  type CuratedCompany
} from "../data/curatedCompanyCatalog";
import {
  loadJobSourceConfigs,
  loadNormalizedJobs,
  runManualScan,
  upsertJobSourceConfig
} from "./jobIngestion";

/**
 * Curated-catalog-driven job discovery.
 *
 * The platform owns a small catalog of well-known engineering
 * employers (curatedCompanyCatalog.ts), tagged by industry and
 * role family. The LLM extracts industries + role families from
 * the candidate's resume; this service intersects the two and
 * runs the existing Greenhouse / Lever ingestion connectors
 * against the matched companies. Result: real job openings
 * filtered to roles the candidate could actually apply for, with
 * zero customer-side ATS configuration.
 *
 * Hard rules:
 * - Idempotent: re-running with the same recommendation is a
 *   no-op once configs + jobs are seeded. Cache TTL keeps repeat
 *   ingestion from spamming the boards on every page reload.
 * - Network failures are isolated per-source. One company's board
 *   being down doesn't block the rest. Per-source 12s timeout via
 *   AbortController so a slow board can't stall the page.
 * - Never logs the resume content; only structural metadata
 *   (slug, http status, jobs returned) is suitable for audit.
 */

const DISCOVERY_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes per session
const PER_SOURCE_TIMEOUT_MS = 12_000;
const DISCOVERY_TIMESTAMP_KEY_SUFFIX = "company_discovery_last_run_at";

export interface CompanyDiscoveryResult {
  /** Companies matched from the catalog. */
  matched: CuratedCompany[];
  /** Companies whose ingestion succeeded this run. */
  succeeded: CuratedCompany[];
  /** Companies whose ingestion failed (board down, slug invalid, …). */
  failed: Array<{ company: CuratedCompany; error: string }>;
  /** True when the cache TTL was honoured and no ingestion ran. */
  cached: boolean;
  /** Total NormalizedJob records present after the run. */
  totalJobs: number;
}

interface DiscoverOptions {
  /** Skip the per-session cache and force ingestion. */
  force?: boolean;
  /** Inject a fetch impl (tests). */
  fetcher?: typeof fetch;
  /** Override TTL (tests). */
  ttlMs?: number;
}

function discoveryTimestampKey(session: AppSession): string {
  return `${session.tenant.id}:${session.userId}:${DISCOVERY_TIMESTAMP_KEY_SUFFIX}`;
}

function readLastDiscoveryAt(session: AppSession): number {
  if (typeof window === "undefined") return 0;
  try {
    const raw = window.localStorage.getItem(discoveryTimestampKey(session));
    const parsed = raw ? Number.parseInt(raw, 10) : 0;
    return Number.isFinite(parsed) ? parsed : 0;
  } catch {
    return 0;
  }
}

function writeLastDiscoveryAt(session: AppSession, ts: number): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      discoveryTimestampKey(session),
      String(ts)
    );
  } catch {
    /* localStorage might be quota-exceeded — discovery still ran */
  }
}

/**
 * Pick curated companies relevant to the candidate's resume,
 * based on the LLM's recommendation output.
 */
export function discoverCompaniesForRecommendation(
  recommendation: JobTargetRecommendation | null
): CuratedCompany[] {
  if (!recommendation) return [];
  const roleTitles = [
    ...recommendation.strongestRoles,
    ...recommendation.adjacentRoles,
    ...recommendation.stretchRoles
  ].map((role) => role.title);
  return pickCuratedCompaniesForResume({
    industries: recommendation.recommendedIndustries ?? [],
    roleTitles,
    searchKeywords: recommendation.recommendedSearchKeywords ?? []
  });
}

/**
 * Ensure a JobSourceConfig record exists for each company in
 * the input list. Idempotent — only creates a config when one
 * isn't already present for the same (source, slug) pair.
 * Returns the configs that exist after the call (existing +
 * newly created).
 */
export function ensureCuratedCompanyConfigsSeeded(
  session: AppSession,
  companies: CuratedCompany[]
): JobSourceConfig[] {
  const existing = loadJobSourceConfigs(session);
  const matched: JobSourceConfig[] = [];
  for (const company of companies) {
    const already = existing.find(
      (config) =>
        config.source === company.source &&
        config.boardToken.trim().toLowerCase() === company.slug.toLowerCase()
    );
    if (already) {
      matched.push(already);
      continue;
    }
    const created = upsertJobSourceConfig(session, {
      source: company.source,
      displayName: company.displayName,
      companyName: company.displayName,
      boardToken: company.slug,
      siteName: "",
      manualUrl: "",
      schedule: "manual",
      enabled: true
    });
    matched.push(created);
  }
  return matched;
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  reason: string
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(reason)), timeoutMs);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

/**
 * Discover + ingest in one call. Returns a structured result
 * suitable for surfacing in Admin diagnostics or audit, but never
 * blocks the UI on a slow source — each company's scan has its
 * own timeout and errors are isolated.
 */
export async function discoverAndIngestForRecommendation(
  session: AppSession,
  recommendation: JobTargetRecommendation | null,
  options: DiscoverOptions = {}
): Promise<CompanyDiscoveryResult> {
  const matched = discoverCompaniesForRecommendation(recommendation);
  if (matched.length === 0) {
    return {
      matched: [],
      succeeded: [],
      failed: [],
      cached: false,
      totalJobs: loadNormalizedJobs(session).length
    };
  }

  const ttlMs = options.ttlMs ?? DISCOVERY_CACHE_TTL_MS;
  const lastRunAt = readLastDiscoveryAt(session);
  if (!options.force && Date.now() - lastRunAt < ttlMs) {
    return {
      matched,
      succeeded: [],
      failed: [],
      cached: true,
      totalJobs: loadNormalizedJobs(session).length
    };
  }

  const configs = ensureCuratedCompanyConfigsSeeded(session, matched);
  const fetcher = options.fetcher ?? fetch;

  // Parallel-with-isolation: one failed scan doesn't block the
  // others. Per-source timeout prevents a stalled board from
  // hanging the whole discovery.
  //
  // runManualScan ALWAYS resolves — it catches connector errors
  // internally and returns a ManualScanResult with
  // scanRun.status="failed" + scanRun.errorMessage. So we can't
  // rely on Promise.allSettled rejection to detect failure;
  // instead we inspect the returned ScanRun status. The
  // withTimeout wrapper is the one path that genuinely rejects
  // (when the entire scan stalls).
  const settled = await Promise.allSettled(
    configs.map((config) =>
      withTimeout(
        runManualScan(session, config.id, fetcher),
        PER_SOURCE_TIMEOUT_MS,
        `company-discovery-timeout:${config.boardToken}`
      )
    )
  );

  const succeeded: CuratedCompany[] = [];
  const failed: Array<{ company: CuratedCompany; error: string }> = [];
  settled.forEach((outcome, index) => {
    const company = matched[index];
    if (outcome.status === "rejected") {
      failed.push({
        company,
        error:
          outcome.reason instanceof Error
            ? outcome.reason.message
            : String(outcome.reason)
      });
      return;
    }
    const run = outcome.value.scanRun;
    if (run.status === "failed") {
      failed.push({
        company,
        error: run.errorMessage || "scan failed"
      });
      return;
    }
    succeeded.push(company);
  });

  writeLastDiscoveryAt(session, Date.now());

  return {
    matched,
    succeeded,
    failed,
    cached: false,
    totalJobs: loadNormalizedJobs(session).length
  };
}

/** Re-export so callers don't have to dig into the data layer. */
export { CURATED_COMPANY_CATALOG };
