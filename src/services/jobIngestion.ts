import type {
  AppSession,
  JobRemoteType,
  JobSource,
  JobSourceConfig,
  NormalizedJob,
  ScanRun,
  ScanSchedule
} from "../models/domain";
import {
  jobSourceConfigSchema,
  normalizedJobSchema,
  scanRunSchema
} from "../models/schemas";
import { readJson, scopedKey, writeJson } from "../lib/storage";

export type Fetcher = typeof fetch;

export interface JobSourceConfigDraft {
  source: JobSource;
  displayName: string;
  companyName: string;
  boardToken: string;
  siteName: string;
  manualUrl: string;
  schedule: ScanSchedule;
  enabled: boolean;
}

export interface JobIngestionRequest {
  session: AppSession;
  config: JobSourceConfig;
  fetcher?: Fetcher;
}

export interface JobIngestionResult {
  jobs: NormalizedJob[];
}

export interface JobIngestionConnector {
  source: JobSource;
  ingest(request: JobIngestionRequest): Promise<JobIngestionResult>;
}

export interface JobUpsertSummary {
  jobs: NormalizedJob[];
  inserted: number;
  updated: number;
  duplicatesSkipped: number;
  duplicateReasons: Record<string, number>;
}

export interface ManualScanResult {
  scanRun: ScanRun;
  jobs: NormalizedJob[];
  configs: JobSourceConfig[];
}

interface GreenhouseJob {
  id: number | string;
  internal_job_id?: number | string | null;
  title?: string;
  updated_at?: string;
  location?: {
    name?: string;
  };
  absolute_url?: string;
  content?: string;
}

interface GreenhouseResponse {
  jobs?: GreenhouseJob[];
}

interface LeverJob {
  id: string;
  text?: string;
  categories?: {
    location?: string;
    allLocations?: string[];
  };
  workplaceType?: "unspecified" | "on-site" | "remote" | "hybrid";
  openingPlain?: string;
  description?: string;
  descriptionPlain?: string;
  descriptionBodyPlain?: string;
  lists?: Array<{
    text?: string;
    content?: string;
  }>;
  hostedUrl?: string;
  applyUrl?: string;
  createdAt?: number;
  salaryRange?: {
    min?: number;
    max?: number;
  };
}

function createId(prefix: string): string {
  return `${prefix}_${globalThis.crypto.randomUUID()}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function configsKey(session: AppSession): string {
  return scopedKey(session.tenant.id, session.userId, "job_source_configs");
}

function jobsKey(session: AppSession): string {
  return scopedKey(session.tenant.id, session.userId, "normalized_jobs");
}

function scanRunsKey(session: AppSession): string {
  return scopedKey(session.tenant.id, session.userId, "scan_runs");
}

function requireBoardToken(config: JobSourceConfig): string {
  if (!config.boardToken.trim()) {
    throw new Error("Greenhouse board token is required.");
  }

  return encodeURIComponent(config.boardToken.trim());
}

function requireSiteName(config: JobSourceConfig): string {
  if (!config.siteName.trim()) {
    throw new Error("Lever site name is required.");
  }

  return encodeURIComponent(config.siteName.trim());
}

function readableCompany(config: JobSourceConfig): string {
  return (
    config.companyName.trim() ||
    config.displayName.trim() ||
    config.boardToken.trim() ||
    config.siteName.trim() ||
    "Unknown company"
  );
}

function stripHtml(value: string | undefined): string {
  if (!value) {
    return "";
  }

  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, "\"")
    .replace(/\s+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function compactText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function toIsoDate(value: string | number | undefined): string | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const date = typeof value === "number" ? new Date(value) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function detectRemoteType(
  location: string,
  description: string,
  workplaceType?: LeverJob["workplaceType"]
): JobRemoteType {
  if (workplaceType === "remote") {
    return "remote";
  }

  if (workplaceType === "hybrid") {
    return "hybrid";
  }

  if (workplaceType === "on-site") {
    return "onsite";
  }

  const searchable = `${location} ${description}`.toLowerCase();
  if (searchable.includes("hybrid")) {
    return "hybrid";
  }

  if (searchable.includes("remote")) {
    return "remote";
  }

  if (searchable.includes("onsite") || searchable.includes("on-site")) {
    return "onsite";
  }

  return location.trim() ? "onsite" : "unknown";
}

function extractSectionLines(description: string, markers: string[]): string[] {
  const lines = description
    .split(/\n|•|- /)
    .map((line) => compactText(line))
    .filter((line) => line.length > 12);

  const matches = lines.filter((line) => {
    const normalized = line.toLowerCase();
    return markers.some((marker) => normalized.includes(marker));
  });

  return matches.slice(0, 8);
}

function classifyLeverList(
  lists: LeverJob["lists"],
  labels: string[]
): string[] {
  if (!lists) {
    return [];
  }

  return lists
    .filter((list) => {
      const text = (list.text ?? "").toLowerCase();
      return labels.some((label) => text.includes(label));
    })
    .flatMap((list) => stripHtml(list.content).split(/\n/))
    .map((line) => compactText(line))
    .filter((line) => line.length > 0)
    .slice(0, 12);
}

function normalizeUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return value.trim();
  }
}

function normalizeComparable(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function descriptionFingerprint(value: string): string {
  return normalizeComparable(value).slice(0, 320);
}

function incrementReason(
  reasons: Record<string, number>,
  reason: string | null
): void {
  if (!reason) {
    return;
  }

  reasons[reason] = (reasons[reason] ?? 0) + 1;
}

function findDuplicateReason(
  existing: NormalizedJob,
  incoming: NormalizedJob
): string | null {
  if (
    existing.source === incoming.source &&
    existing.sourceJobId === incoming.sourceJobId
  ) {
    return "ats_job_id";
  }

  if (normalizeUrl(existing.applicationUrl) === normalizeUrl(incoming.applicationUrl)) {
    return "application_url";
  }

  const existingCompanyTitleLocation = [
    existing.company,
    existing.title,
    existing.location
  ]
    .map(normalizeComparable)
    .join("|");
  const incomingCompanyTitleLocation = [
    incoming.company,
    incoming.title,
    incoming.location
  ]
    .map(normalizeComparable)
    .join("|");

  if (
    existingCompanyTitleLocation.length > 2 &&
    existingCompanyTitleLocation === incomingCompanyTitleLocation
  ) {
    return "company_title_location";
  }

  const existingFingerprint = descriptionFingerprint(existing.description);
  const incomingFingerprint = descriptionFingerprint(incoming.description);
  if (
    existingFingerprint.length > 120 &&
    existingFingerprint === incomingFingerprint
  ) {
    return "description_similarity_placeholder";
  }

  return null;
}

export function loadJobSourceConfigs(session: AppSession): JobSourceConfig[] {
  const configs = readJson<JobSourceConfig[]>(configsKey(session), []);
  return configs.filter((config) => jobSourceConfigSchema.safeParse(config).success);
}

export function saveJobSourceConfigs(
  session: AppSession,
  configs: JobSourceConfig[]
): JobSourceConfig[] {
  const parsed = configs.map((config) => jobSourceConfigSchema.parse(config));
  writeJson(configsKey(session), parsed);
  return parsed;
}

export function upsertJobSourceConfig(
  session: AppSession,
  draft: JobSourceConfigDraft,
  existingConfigId?: string
): JobSourceConfig {
  const existingConfigs = loadJobSourceConfigs(session);
  const existing = existingConfigs.find((config) => config.id === existingConfigId);
  const timestamp = nowIso();
  const config: JobSourceConfig = {
    id: existing?.id ?? createId("source"),
    tenantId: session.tenant.id,
    userId: session.userId,
    source: draft.source,
    displayName: draft.displayName.trim(),
    companyName: draft.companyName.trim(),
    boardToken: draft.boardToken.trim(),
    siteName: draft.siteName.trim(),
    manualUrl: draft.manualUrl.trim(),
    schedule: draft.schedule,
    enabled: draft.enabled,
    lastScanAt: existing?.lastScanAt ?? null,
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp
  };

  const parsed = jobSourceConfigSchema.parse(config);
  const nextConfigs = existing
    ? existingConfigs.map((item) => (item.id === parsed.id ? parsed : item))
    : [parsed, ...existingConfigs];

  saveJobSourceConfigs(session, nextConfigs);
  return parsed;
}

export function loadNormalizedJobs(session: AppSession): NormalizedJob[] {
  const jobs = readJson<NormalizedJob[]>(jobsKey(session), []);
  return jobs
    .map((job) => {
      const parsed = normalizedJobSchema.safeParse(job);
      if (!parsed.success) {
        return null;
      }

      if (parsed.data.source !== "manual") {
        return parsed.data;
      }

      return normalizedJobSchema.parse({
        ...parsed.data,
        title:
          parsed.data.title.toLowerCase().includes("manual import queued")
            ? "Manually imported job"
            : parsed.data.title,
        description:
          parsed.data.description.toLowerCase().includes("manual job url import") ||
          parsed.data.description.toLowerCase().includes("normalize this posting")
            ? "This manually imported job has limited details. Add more information later for stronger scoring confidence."
            : parsed.data.description
      });
    })
    .filter((job): job is NormalizedJob => Boolean(job));
}

export function saveNormalizedJobs(
  session: AppSession,
  jobs: NormalizedJob[]
): NormalizedJob[] {
  const parsed = jobs.map((job) => normalizedJobSchema.parse(job));
  writeJson(jobsKey(session), parsed);
  return parsed;
}

export function loadScanRuns(session: AppSession): ScanRun[] {
  const runs = readJson<ScanRun[]>(scanRunsKey(session), []);
  return runs.filter((run) => scanRunSchema.safeParse(run).success);
}

export function saveScanRuns(session: AppSession, runs: ScanRun[]): ScanRun[] {
  const parsed = runs.map((run) => scanRunSchema.parse(run));
  writeJson(scanRunsKey(session), parsed.slice(0, 100));
  return parsed;
}

export function isConfigDueForScheduledScan(
  config: JobSourceConfig,
  at: Date = new Date()
): boolean {
  if (!config.enabled || config.schedule === "manual") {
    return false;
  }

  if (!config.lastScanAt) {
    return true;
  }

  const lastScanAt = new Date(config.lastScanAt).getTime();
  const intervalMs =
    config.schedule === "every_6_hours"
      ? 6 * 60 * 60 * 1000
      : 24 * 60 * 60 * 1000;

  return at.getTime() - lastScanAt >= intervalMs;
}

export function getDueSourceConfigs(
  configs: JobSourceConfig[],
  at: Date = new Date()
): JobSourceConfig[] {
  return configs.filter((config) => isConfigDueForScheduledScan(config, at));
}

export function deduplicateAndMergeJobs(
  existingJobs: NormalizedJob[],
  incomingJobs: NormalizedJob[]
): JobUpsertSummary {
  const jobs = [...existingJobs];
  const duplicateReasons: Record<string, number> = {};
  let inserted = 0;
  let updated = 0;
  let duplicatesSkipped = 0;

  incomingJobs.forEach((incomingJob) => {
    const duplicateIndex = jobs.findIndex(
      (existingJob) => findDuplicateReason(existingJob, incomingJob) !== null
    );

    if (duplicateIndex === -1) {
      jobs.unshift(incomingJob);
      inserted += 1;
      return;
    }

    const duplicateReason = findDuplicateReason(jobs[duplicateIndex], incomingJob);
    incrementReason(duplicateReasons, duplicateReason);
    duplicatesSkipped += 1;

    if (duplicateReason === "ats_job_id" || duplicateReason === "application_url") {
      const existingJob = jobs[duplicateIndex];
      jobs[duplicateIndex] = normalizedJobSchema.parse({
        ...incomingJob,
        id: existingJob.id,
        createdAt: existingJob.createdAt,
        scoringStatus: existingJob.scoringStatus,
        updatedAt: nowIso()
      });
      updated += 1;
    }
  });

  return {
    jobs,
    inserted,
    updated,
    duplicatesSkipped,
    duplicateReasons
  };
}

export function createGreenhouseConnector(): JobIngestionConnector {
  return {
    source: "greenhouse",
    async ingest({ session, config, fetcher = fetch }) {
      const boardToken = requireBoardToken(config);
      const response = await fetcher(
        `https://boards-api.greenhouse.io/v1/boards/${boardToken}/jobs?content=true`,
        {
          headers: {
            Accept: "application/json"
          }
        }
      );

      if (!response.ok) {
        throw new Error(
          `Greenhouse scan failed with ${response.status} ${response.statusText}`
        );
      }

      const payload = (await response.json()) as GreenhouseResponse;
      const timestamp = nowIso();
      const jobs = (payload.jobs ?? []).map((job) => {
        const description = stripHtml(job.content);
        const location = job.location?.name ?? "";

        return normalizedJobSchema.parse({
          id: createId("job"),
          tenantId: session.tenant.id,
          userId: session.userId,
          sourceConfigId: config.id,
          source: "greenhouse",
          sourceJobId: String(job.id),
          title: job.title?.trim() || "Untitled role",
          company: readableCompany(config),
          location,
          remoteType: detectRemoteType(location, description),
          salaryMin: null,
          salaryMax: null,
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
            job.absolute_url ||
            `https://boards.greenhouse.io/${boardToken}/jobs/${job.id}`,
          atsType: "greenhouse",
          postedAt: toIsoDate(job.updated_at),
          discoveredAt: timestamp,
          scoringStatus: "queued",
          createdAt: timestamp,
          updatedAt: timestamp
        });
      });

      return { jobs };
    }
  };
}

export function createLeverConnector(): JobIngestionConnector {
  return {
    source: "lever",
    async ingest({ session, config, fetcher = fetch }) {
      const siteName = requireSiteName(config);
      const response = await fetcher(
        `https://api.lever.co/v0/postings/${siteName}?mode=json&limit=100`,
        {
          headers: {
            Accept: "application/json"
          }
        }
      );

      if (!response.ok) {
        throw new Error(`Lever scan failed with ${response.status} ${response.statusText}`);
      }

      const payload = (await response.json()) as LeverJob[];
      const timestamp = nowIso();
      const jobs = payload.map((job) => {
        const description =
          job.descriptionPlain ||
          job.descriptionBodyPlain ||
          job.openingPlain ||
          stripHtml(job.description);
        const location =
          job.categories?.allLocations?.join(", ") || job.categories?.location || "";

        return normalizedJobSchema.parse({
          id: createId("job"),
          tenantId: session.tenant.id,
          userId: session.userId,
          sourceConfigId: config.id,
          source: "lever",
          sourceJobId: job.id,
          title: job.text?.trim() || "Untitled role",
          company: readableCompany(config),
          location,
          remoteType: detectRemoteType(location, description, job.workplaceType),
          salaryMin: job.salaryRange?.min ? Math.round(job.salaryRange.min) : null,
          salaryMax: job.salaryRange?.max ? Math.round(job.salaryRange.max) : null,
          description,
          responsibilities: classifyLeverList(job.lists, [
            "responsibil",
            "what you",
            "role"
          ]),
          requirements: classifyLeverList(job.lists, [
            "requirement",
            "qualification",
            "about you"
          ]),
          applicationUrl:
            job.applyUrl || job.hostedUrl || `https://jobs.lever.co/${siteName}/${job.id}`,
          atsType: "lever",
          postedAt: toIsoDate(job.createdAt),
          discoveredAt: timestamp,
          scoringStatus: "queued",
          createdAt: timestamp,
          updatedAt: timestamp
        });
      });

      return { jobs };
    }
  };
}

export function createManualJobImportPlaceholder(
  session: AppSession,
  url: string
): NormalizedJob {
  const timestamp = nowIso();
  const normalizedUrl = normalizeUrl(url);

  return normalizedJobSchema.parse({
    id: createId("job"),
    tenantId: session.tenant.id,
    userId: session.userId,
    sourceConfigId: null,
    source: "manual",
    sourceJobId: normalizedUrl,
    title: "Manually imported job",
    company: "Unknown company",
    location: "Unknown",
    remoteType: "unknown",
    salaryMin: null,
    salaryMax: null,
    description:
      "This manually imported job has limited details. Add more information later for stronger scoring confidence.",
    responsibilities: [],
    requirements: [],
    applicationUrl: normalizedUrl,
    atsType: "manual",
    postedAt: null,
    discoveredAt: timestamp,
    scoringStatus: "queued",
    createdAt: timestamp,
    updatedAt: timestamp
  });
}

export function importManualJobUrl(
  session: AppSession,
  url: string
): JobUpsertSummary {
  const incomingJob = createManualJobImportPlaceholder(session, url);
  const summary = deduplicateAndMergeJobs(loadNormalizedJobs(session), [incomingJob]);
  saveNormalizedJobs(session, summary.jobs);
  return summary;
}

function connectorFor(source: JobSource): JobIngestionConnector {
  if (source === "greenhouse") {
    return createGreenhouseConnector();
  }

  if (source === "lever") {
    return createLeverConnector();
  }

  throw new Error(`${source} scans are not available for this workspace yet.`);
}

export async function runManualScan(
  session: AppSession,
  configId: string,
  fetcher: Fetcher = fetch
): Promise<ManualScanResult> {
  const configs = loadJobSourceConfigs(session);
  const config = configs.find((item) => item.id === configId);
  if (!config) {
    throw new Error("Source configuration was not found.");
  }

  if (!config.enabled) {
    throw new Error("Source configuration is disabled.");
  }

  const startedAt = nowIso();
  const runningRun: ScanRun = scanRunSchema.parse({
    id: createId("scan"),
    tenantId: session.tenant.id,
    userId: session.userId,
    sourceConfigId: config.id,
    source: config.source,
    status: "running",
    startedAt,
    finishedAt: null,
    jobsFetched: 0,
    jobsInserted: 0,
    jobsUpdated: 0,
    duplicatesSkipped: 0,
    errorMessage: ""
  });

  saveScanRuns(session, [runningRun, ...loadScanRuns(session)]);

  try {
    const connector = connectorFor(config.source);
    const result = await connector.ingest({ session, config, fetcher });
    const summary = deduplicateAndMergeJobs(loadNormalizedJobs(session), result.jobs);
    const jobs = saveNormalizedJobs(session, summary.jobs);
    const finishedAt = nowIso();
    const completedRun: ScanRun = scanRunSchema.parse({
      ...runningRun,
      status: "succeeded",
      finishedAt,
      jobsFetched: result.jobs.length,
      jobsInserted: summary.inserted,
      jobsUpdated: summary.updated,
      duplicatesSkipped: summary.duplicatesSkipped
    });
    const nextConfigs = configs.map((item) =>
      item.id === config.id
        ? jobSourceConfigSchema.parse({
            ...item,
            lastScanAt: finishedAt,
            updatedAt: finishedAt
          })
        : item
    );

    saveJobSourceConfigs(session, nextConfigs);
    saveScanRuns(
      session,
      loadScanRuns(session).map((run) => (run.id === runningRun.id ? completedRun : run))
    );

    return {
      scanRun: completedRun,
      jobs,
      configs: nextConfigs
    };
  } catch (error) {
    const failedRun: ScanRun = scanRunSchema.parse({
      ...runningRun,
      status: "failed",
      finishedAt: nowIso(),
      errorMessage:
        error instanceof Error ? error.message : "Unknown ingestion failure."
    });

    saveScanRuns(
      session,
      loadScanRuns(session).map((run) => (run.id === runningRun.id ? failedRun : run))
    );

    return {
      scanRun: failedRun,
      jobs: loadNormalizedJobs(session),
      configs
    };
  }
}

export async function runDueScheduledScans(
  session: AppSession,
  fetcher: Fetcher = fetch,
  at: Date = new Date()
): Promise<ManualScanResult[]> {
  const dueConfigs = getDueSourceConfigs(loadJobSourceConfigs(session), at);
  const results: ManualScanResult[] = [];

  for (const config of dueConfigs) {
    results.push(await runManualScan(session, config.id, fetcher));
  }

  return results;
}
