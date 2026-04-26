import type {
  AppSession,
  ApplicationRecord,
  AuditLog,
  CareerOpsDigestSummary,
  CareerOpsRun,
  CareerOpsRunMode,
  CareerOpsScheduleMode,
  CareerOpsSettings,
  JobMatch,
  NormalizedJob,
  Resume,
  UserProfile
} from "../models/domain";
import {
  careerOpsRunSchema,
  careerOpsSettingsSchema
} from "../models/schemas";
import { readJson, scopedKey, writeJson } from "../lib/storage";
import {
  loadJobSourceConfigs,
  loadNormalizedJobs,
  loadScanRuns,
  runManualScan,
  type ManualScanResult
} from "./jobIngestion";
import { loadJobMatches, scoreJobsForProfile } from "./matchEngine";
import { loadUserProfile } from "./profileService";
import { loadResume } from "./resumeService";
import { loadApplications, upsertApplicationRecord } from "./applicationService";
import {
  generateApplicationPackage,
  loadApplicationPackages
} from "./applicationPackage";
import {
  generateCompanyIntelligence,
  jobHasHighRiskSignal
} from "./intelligenceService";

type AuditMetadata = AuditLog["metadata"];

export interface CareerOpsAuditEvent {
  action: string;
  resourceType: string;
  resourceId: string;
  metadata: AuditMetadata;
}

export interface CareerOpsRunResult {
  run: CareerOpsRun;
  runs: CareerOpsRun[];
  auditEvents: CareerOpsAuditEvent[];
}

const SETTINGS_KEY = "career_ops_settings";
const RUNS_KEY = "career_ops_runs";
const DEFAULT_HIGH_SCORE_THRESHOLD = 8.0;

function nowIso(): string {
  return new Date().toISOString();
}

function createId(prefix: string): string {
  return `${prefix}_${globalThis.crypto.randomUUID()}`;
}

function settingsKey(session: AppSession): string {
  return scopedKey(session.tenant.id, session.userId, SETTINGS_KEY);
}

function runsKey(session: AppSession): string {
  return scopedKey(session.tenant.id, session.userId, RUNS_KEY);
}

export function defaultCareerOpsSettings(session: AppSession): CareerOpsSettings {
  const timestamp = nowIso();
  return careerOpsSettingsSchema.parse({
    id: `settings_${session.tenant.id}_${session.userId}`,
    tenantId: session.tenant.id,
    userId: session.userId,
    scheduleMode: "manual_only",
    preparePackagesForHighScoreJobs: false,
    highScoreThreshold: DEFAULT_HIGH_SCORE_THRESHOLD,
    overrideHighRiskPackagePrep: false,
    createdAt: timestamp,
    updatedAt: timestamp
  });
}

export function loadCareerOpsSettings(session: AppSession): CareerOpsSettings {
  const stored = readJson<CareerOpsSettings | null>(settingsKey(session), null);
  if (!stored) {
    const defaults = defaultCareerOpsSettings(session);
    writeJson(settingsKey(session), defaults);
    return defaults;
  }
  const parsed = careerOpsSettingsSchema.safeParse(stored);
  if (!parsed.success) {
    const defaults = defaultCareerOpsSettings(session);
    writeJson(settingsKey(session), defaults);
    return defaults;
  }
  return parsed.data;
}

export function saveCareerOpsSettings(
  session: AppSession,
  next: Partial<Omit<CareerOpsSettings, "id" | "tenantId" | "userId" | "createdAt">>
): CareerOpsSettings {
  const existing = loadCareerOpsSettings(session);
  const merged = careerOpsSettingsSchema.parse({
    ...existing,
    ...next,
    updatedAt: nowIso()
  });
  writeJson(settingsKey(session), merged);
  return merged;
}

export function loadCareerOpsRuns(session: AppSession): CareerOpsRun[] {
  const runs = readJson<CareerOpsRun[]>(runsKey(session), []);
  return runs.filter((run) => careerOpsRunSchema.safeParse(run).success);
}

function persistRuns(
  session: AppSession,
  runs: CareerOpsRun[]
): CareerOpsRun[] {
  const parsed = runs.map((run) => careerOpsRunSchema.parse(run));
  writeJson(runsKey(session), parsed.slice(0, 100));
  return parsed;
}

export function nextScheduledRunAt(
  settings: CareerOpsSettings,
  lastRunAt: string | null,
  now: Date = new Date()
): string | null {
  if (
    settings.scheduleMode === "disabled" ||
    settings.scheduleMode === "manual_only"
  ) {
    return null;
  }
  const intervalMs =
    settings.scheduleMode === "daily"
      ? 24 * 60 * 60 * 1000
      : 6 * 60 * 60 * 1000;
  const base = lastRunAt ? new Date(lastRunAt).getTime() : now.getTime();
  return new Date(base + intervalMs).toISOString();
}

export function isCareerOpsRunDue(
  settings: CareerOpsSettings,
  lastRunAt: string | null,
  now: Date = new Date()
): boolean {
  const next = nextScheduledRunAt(settings, lastRunAt, now);
  if (!next) return false;
  return new Date(next).getTime() <= now.getTime();
}

function event(
  action: string,
  run: CareerOpsRun,
  metadata: AuditMetadata = {}
): CareerOpsAuditEvent {
  return {
    action,
    resourceType: "CareerOpsRun",
    resourceId: run.id,
    metadata: {
      mode: run.mode,
      status: run.status,
      ...metadata
    }
  };
}

function profileIsComplete(profile: UserProfile | null): boolean {
  if (!profile) return false;
  return Boolean(
    profile.fullName &&
      profile.email &&
      (profile.targetTitles.length > 0 || profile.careerSummary)
  );
}

function avoidedCompanyNames(profile: UserProfile | null): Set<string> {
  if (!profile) return new Set();
  return new Set(
    profile.companiesToAvoid
      .map((name) => name.trim().toLowerCase())
      .filter((name) => name.length > 0)
  );
}

function isAvoidedCompany(
  job: NormalizedJob,
  avoided: Set<string>
): boolean {
  if (avoided.size === 0) return false;
  return avoided.has(job.company.trim().toLowerCase());
}

function lineFromCount(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function buildDigest(input: {
  jobsFound: number;
  applyCount: number;
  maybeCount: number;
  browseCount: number;
  packagesPrepared: number;
  warnings: string[];
}): CareerOpsDigestSummary {
  const lines = [
    `Found ${input.jobsFound} new ${input.jobsFound === 1 ? "job" : "jobs"}.`,
    `${input.applyCount} ${input.applyCount === 1 ? "is a strong match" : "are strong matches"}.`,
    `${input.maybeCount} ${input.maybeCount === 1 ? "is a medium match" : "are medium matches"}.`,
    `${lineFromCount(input.browseCount, "lower-score job is", "lower-score jobs are")} available for browsing.`,
    `Prepared ${input.packagesPrepared} application ${input.packagesPrepared === 1 ? "package" : "packages"} for review.`
  ];

  let recommendedNextAction = "No new jobs found. Add or enable a source and try again.";
  if (input.applyCount > 0) {
    recommendedNextAction = "Review Apply Queue.";
  } else if (input.maybeCount > 0) {
    recommendedNextAction = "Review Maybe Queue.";
  } else if (input.browseCount > 0) {
    recommendedNextAction = "Browse the available jobs.";
  }

  return {
    jobsFound: input.jobsFound,
    highMatches: input.applyCount,
    mediumMatches: input.maybeCount,
    lowMatches: input.browseCount,
    packagesPrepared: input.packagesPrepared,
    recommendedNextAction,
    warnings: input.warnings,
    lines
  };
}

interface RunCareerOpsOptions {
  mode?: CareerOpsRunMode;
  fetcher?: typeof fetch;
}

export async function runCareerOps(
  session: AppSession,
  options: RunCareerOpsOptions = {}
): Promise<CareerOpsRunResult> {
  const mode = options.mode ?? "manual";
  const settings = loadCareerOpsSettings(session);
  const startedAt = nowIso();
  const profile = loadUserProfile(session);
  const resume: Resume | null = loadResume(session);
  const warnings: string[] = [];
  const auditEvents: CareerOpsAuditEvent[] = [];

  const baseRun: CareerOpsRun = careerOpsRunSchema.parse({
    id: createId("careerops"),
    tenantId: session.tenant.id,
    userId: session.userId,
    mode,
    status: "running",
    startedAt,
    completedAt: null,
    ingestionRunIds: [],
    jobsFound: 0,
    jobsInserted: 0,
    jobsUpdated: 0,
    duplicatesFound: 0,
    jobsScored: 0,
    applyReviewCount: 0,
    maybeCount: 0,
    browseCount: 0,
    packagesPrepared: 0,
    digestSummary: buildDigest({
      jobsFound: 0,
      applyCount: 0,
      maybeCount: 0,
      browseCount: 0,
      packagesPrepared: 0,
      warnings: []
    }),
    errorMessage: "",
    createdAt: startedAt,
    updatedAt: startedAt
  });
  persistRuns(session, [baseRun, ...loadCareerOpsRuns(session)]);
  auditEvents.push(event("career_ops_run_started", baseRun, { startedAt }));

  if (!profileIsComplete(profile)) {
    warnings.push(
      "Profile is incomplete; results may have lower match confidence."
    );
  }
  if (!resume) {
    warnings.push("No resume uploaded; package preparation is limited.");
  }

  try {
    // Stage 1: ingestion
    const enabledConfigs = loadJobSourceConfigs(session).filter(
      (config) => config.enabled
    );
    const ingestionRuns: ManualScanResult[] = [];
    let jobsInserted = 0;
    let jobsUpdated = 0;
    let duplicatesFound = 0;
    let jobsFound = 0;
    for (const config of enabledConfigs) {
      const result = await runManualScan(session, config.id, options.fetcher);
      ingestionRuns.push(result);
      if (result.scanRun.status === "succeeded") {
        jobsFound += result.scanRun.jobsFetched;
        jobsInserted += result.scanRun.jobsInserted;
        jobsUpdated += result.scanRun.jobsUpdated;
        duplicatesFound += result.scanRun.duplicatesSkipped;
      } else if (result.scanRun.status === "failed") {
        warnings.push(
          `Source "${config.displayName}" failed: ${result.scanRun.errorMessage}`
        );
      }
    }
    const ingestionRunIds = ingestionRuns.map((result) => result.scanRun.id);
    auditEvents.push(
      event("career_ops_ingestion_completed", baseRun, {
        sources: enabledConfigs.length,
        jobsFound,
        jobsInserted,
        jobsUpdated,
        duplicatesFound
      })
    );

    // Stage 2: scoring (only on jobs not yet scored — keeps the run idempotent)
    const allJobs = loadNormalizedJobs(session);
    const existingMatches = loadJobMatches(session);
    const matchedJobIds = new Set(existingMatches.map((match) => match.jobId));
    const queuedJobs = allJobs.filter(
      (job) => job.scoringStatus === "queued" || !matchedJobIds.has(job.id)
    );
    const scoring = await scoreJobsForProfile(
      session,
      profile,
      queuedJobs,
      existingMatches
    );
    const matches = scoring.matches;
    auditEvents.push(
      event("career_ops_scoring_completed", baseRun, {
        scored: scoring.scoredCount,
        applyCount: scoring.applyCount,
        maybeCount: scoring.maybeCount,
        browseCount: scoring.browseCount
      })
    );

    // Stage 3: optional package preparation for high-score jobs
    let packagesPrepared = 0;
    const avoided = avoidedCompanyNames(profile);
    if (settings.preparePackagesForHighScoreJobs) {
      const existingPackages = loadApplicationPackages(session);
      const packagedAppIds = new Set(
        existingPackages.map((pkg) => pkg.applicationRecordId)
      );
      // Defense-in-depth: surface a warning when the user has any
      // ingested jobs at avoided companies, even if those jobs would
      // not have reached the high-score threshold.
      const avoidedJobsIngested = allJobs.filter((item) =>
        isAvoidedCompany(item, avoided)
      );
      avoidedJobsIngested.forEach((item) => {
        warnings.push(
          `Skipped package for avoided company: ${item.company}`
        );
      });
      const avoidedJobIds = new Set(avoidedJobsIngested.map((item) => item.id));
      const highMatches = matches.filter(
        (match) =>
          match.queue === "apply_review" &&
          match.overallScore >= settings.highScoreThreshold
      );
      for (const match of highMatches) {
        const job = allJobs.find((item) => item.id === match.jobId);
        if (!job) continue;
        if (avoidedJobIds.has(job.id) || isAvoidedCompany(job, avoided)) {
          // Already warned above; do not generate a package.
          continue;
        }
        // Generate intelligence + risk signals so the package prep step can
        // skip jobs flagged as high-risk by default. Intelligence is best-
        // effort context, never authoritative truth.
        let highRisk = false;
        try {
          const intelResult = await generateCompanyIntelligence(session, job, profile);
          highRisk = jobHasHighRiskSignal(intelResult.riskSignals);
        } catch (error) {
          warnings.push(
            `Intelligence generation skipped for ${job.title} at ${job.company}: ${
              error instanceof Error ? error.message : "unknown error"
            }`
          );
        }
        if (highRisk && !settings.overrideHighRiskPackagePrep) {
          warnings.push(
            `Skipped package for high-risk job: ${job.title} at ${job.company}.`
          );
          continue;
        }
        const application = upsertApplicationRecord(session, job.id, {
          status: "draft_prepared"
        });
        if (packagedAppIds.has(application.id)) {
          continue;
        }
        try {
          await generateApplicationPackage({
            session,
            profile,
            job,
            match,
            application,
            resume
          });
          packagesPrepared += 1;
          packagedAppIds.add(application.id);
        } catch (error) {
          warnings.push(
            `Package generation failed for ${job.title} at ${job.company}: ${
              error instanceof Error ? error.message : "unknown error"
            }`
          );
        }
      }
      auditEvents.push(
        event("career_ops_package_preparation_completed", baseRun, {
          packagesPrepared,
          highMatchCandidates: highMatches.length
        })
      );
    }

    const digest = buildDigest({
      jobsFound,
      applyCount: scoring.applyCount,
      maybeCount: scoring.maybeCount,
      browseCount: scoring.browseCount,
      packagesPrepared,
      warnings
    });
    auditEvents.push(
      event("career_ops_digest_created", baseRun, {
        recommendedNextAction: digest.recommendedNextAction,
        warningCount: warnings.length
      })
    );

    const completedAt = nowIso();
    const completedRun: CareerOpsRun = careerOpsRunSchema.parse({
      ...baseRun,
      status: "completed",
      completedAt,
      ingestionRunIds,
      jobsFound,
      jobsInserted,
      jobsUpdated,
      duplicatesFound,
      jobsScored: scoring.scoredCount,
      applyReviewCount: scoring.applyCount,
      maybeCount: scoring.maybeCount,
      browseCount: scoring.browseCount,
      packagesPrepared,
      digestSummary: digest,
      updatedAt: completedAt
    });
    auditEvents.push(event("career_ops_run_completed", completedRun, {}));

    const runs = persistRuns(
      session,
      loadCareerOpsRuns(session).map((run) =>
        run.id === completedRun.id ? completedRun : run
      )
    );

    return { run: completedRun, runs, auditEvents };
  } catch (error) {
    const failedAt = nowIso();
    const failedRun: CareerOpsRun = careerOpsRunSchema.parse({
      ...baseRun,
      status: "failed",
      completedAt: failedAt,
      errorMessage:
        error instanceof Error ? error.message : "Unknown failure during run.",
      digestSummary: buildDigest({
        jobsFound: 0,
        applyCount: 0,
        maybeCount: 0,
        browseCount: 0,
        packagesPrepared: 0,
        warnings: [...warnings, "Career Ops run failed before completion."]
      }),
      updatedAt: failedAt
    });
    auditEvents.push(
      event("career_ops_run_failed", failedRun, {
        errorLength: failedRun.errorMessage.length
      })
    );
    const runs = persistRuns(
      session,
      loadCareerOpsRuns(session).map((run) =>
        run.id === failedRun.id ? failedRun : run
      )
    );
    return { run: failedRun, runs, auditEvents };
  }
}

export interface CareerOpsSummaryView {
  latestRun: CareerOpsRun | null;
  totalRuns: number;
  nextScheduledRunAt: string | null;
  lastSuccessfulRunAt: string | null;
}

export function summarizeCareerOps(
  runs: CareerOpsRun[],
  settings: CareerOpsSettings,
  now: Date = new Date()
): CareerOpsSummaryView {
  const latest = runs[0] ?? null;
  const lastSuccess =
    runs.find((run) => run.status === "completed")?.completedAt ?? null;
  return {
    latestRun: latest,
    totalRuns: runs.length,
    nextScheduledRunAt: nextScheduledRunAt(settings, lastSuccess, now),
    lastSuccessfulRunAt: lastSuccess
  };
}

// Re-exports
export type { CareerOpsRun, CareerOpsScheduleMode, CareerOpsSettings } from "../models/domain";
export type { ApplicationRecord, JobMatch };
