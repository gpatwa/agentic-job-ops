import type {
  ApplicationPackage,
  ApplicationRecord,
  AppSession,
  AuditLog,
  AutopilotAction,
  AutopilotActionStatus,
  AutopilotActionType,
  AutopilotActionUrgency,
  AutopilotRun,
  AutopilotRunFrequency,
  AutopilotRunTrigger,
  AutopilotSettings,
  CareerOpsRun,
  JobMatch,
  NormalizedJob,
  UserProfile
} from "../models/domain";
import {
  autopilotActionSchema,
  autopilotRunSchema,
  autopilotSettingsSchema
} from "../models/schemas";
import { readJson, scopedKey, writeJson } from "../lib/storage";
import {
  loadCareerOpsSettings,
  runCareerOps,
  saveCareerOpsSettings,
  type CareerOpsAuditEvent
} from "./careerOpsService";
import { loadApplications } from "./applicationService";
import { loadApplicationPackages } from "./applicationPackage";
import { loadFollowUpReminders, dueRemindersToday } from "./recruiterCrmService";
import { loadJobMatches } from "./matchEngine";
import { loadNormalizedJobs } from "./jobIngestion";
import { loadResumeIntelligenceReports } from "./resumeIntelligenceService";

type AuditMetadata = AuditLog["metadata"];

/**
 * Phase 15 — B2C autopilot.
 *
 * Hard safety invariants:
 * - autopilotCanSubmit() always returns false. Final submit always requires
 *   explicit human approval through the browser application assistant. This
 *   service never has a "submit" code path.
 * - settings.requireApprovalBeforeSubmit is the literal `true`. The schema
 *   enforces it; saveAutopilotSettings rejects any attempt to set it to
 *   false at the service boundary as well, so misuse fails loudly.
 * - Avoided companies and high-risk job signals block automatic package
 *   preparation. The user can override risk on a per-run basis through
 *   the underlying CareerOpsSettings, but never the avoid list.
 *
 * Autopilot wraps CareerOps. It does not duplicate ingestion/scoring/
 * package logic — it configures Career Ops, runs it, then derives a small
 * set of user-facing actions (the Action Center) from the result.
 */

export interface AutopilotAuditEvent {
  action: string;
  resourceType: string;
  resourceId: string;
  metadata: AuditMetadata;
}

const SETTINGS_KEY = "autopilot_settings";
const RUNS_KEY = "autopilot_runs";
const ACTIONS_KEY = "autopilot_actions";

const DEFAULT_HIGH_SCORE_THRESHOLD = 8.0;
const DEFAULT_MAX_PACKAGES_PER_RUN = 3;

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

function actionsKey(session: AppSession): string {
  return scopedKey(session.tenant.id, session.userId, ACTIONS_KEY);
}

export function defaultAutopilotSettings(
  session: AppSession
): AutopilotSettings {
  const timestamp = nowIso();
  return autopilotSettingsSchema.parse({
    id: `autopilot_settings_${session.tenant.id}_${session.userId}`,
    tenantId: session.tenant.id,
    userId: session.userId,
    enabled: false,
    runFrequency: "manual" as AutopilotRunFrequency,
    autoScoreJobs: true,
    autoPreparePackagesForHighScoreJobs: false,
    highScoreThreshold: DEFAULT_HIGH_SCORE_THRESHOLD,
    maxPackagesPerRun: DEFAULT_MAX_PACKAGES_PER_RUN,
    requireReviewBeforePackageGeneration: false,
    requireApprovalBeforeSubmit: true as const,
    excludedCompanies: [],
    preferredWorkStyle: "any",
    targetRoles: [],
    createdAt: timestamp,
    updatedAt: timestamp
  });
}

export function loadAutopilotSettings(
  session: AppSession
): AutopilotSettings {
  const stored = readJson<AutopilotSettings | null>(settingsKey(session), null);
  if (!stored) {
    const defaults = defaultAutopilotSettings(session);
    writeJson(settingsKey(session), defaults);
    return defaults;
  }
  const parsed = autopilotSettingsSchema.safeParse(stored);
  if (!parsed.success) {
    const defaults = defaultAutopilotSettings(session);
    writeJson(settingsKey(session), defaults);
    return defaults;
  }
  return parsed.data;
}

export type AutopilotSettingsUpdate = Partial<
  Omit<
    AutopilotSettings,
    "id" | "tenantId" | "userId" | "createdAt" | "requireApprovalBeforeSubmit"
  >
> & {
  /**
   * Optional but only `true` is ever accepted. If the caller passes
   * anything else the setter throws so the safety invariant fails loudly
   * at the service boundary instead of silently being persisted.
   */
  requireApprovalBeforeSubmit?: true;
};

export interface SaveAutopilotSettingsResult {
  settings: AutopilotSettings;
  auditEvents: AutopilotAuditEvent[];
}

export function saveAutopilotSettings(
  session: AppSession,
  update: AutopilotSettingsUpdate
): SaveAutopilotSettingsResult {
  if (
    Object.prototype.hasOwnProperty.call(update, "requireApprovalBeforeSubmit") &&
    update.requireApprovalBeforeSubmit !== true
  ) {
    throw new Error(
      "requireApprovalBeforeSubmit cannot be disabled. Final submit always requires explicit user approval."
    );
  }
  const existing = loadAutopilotSettings(session);
  const merged = autopilotSettingsSchema.parse({
    ...existing,
    ...update,
    requireApprovalBeforeSubmit: true,
    updatedAt: nowIso()
  });
  writeJson(settingsKey(session), merged);

  const auditEvents: AutopilotAuditEvent[] = [];
  if (existing.enabled !== merged.enabled) {
    auditEvents.push(
      audit(
        merged.enabled ? "autopilot_enabled" : "autopilot_disabled",
        "AutopilotSettings",
        merged.id,
        {
          runFrequency: merged.runFrequency,
          autoScoreJobs: merged.autoScoreJobs,
          autoPreparePackages: merged.autoPreparePackagesForHighScoreJobs
        }
      )
    );
  }
  auditEvents.push(
    audit("autopilot_settings_updated", "AutopilotSettings", merged.id, {
      runFrequency: merged.runFrequency,
      autoScoreJobs: merged.autoScoreJobs,
      autoPreparePackages: merged.autoPreparePackagesForHighScoreJobs,
      maxPackagesPerRun: merged.maxPackagesPerRun,
      preferredWorkStyle: merged.preferredWorkStyle,
      targetRoleCount: merged.targetRoles.length,
      excludedCompanyCount: merged.excludedCompanies.length
    })
  );
  return { settings: merged, auditEvents };
}

/**
 * Hard safety invariant. Autopilot has no submit code path; this constant
 * exists so callers and evals can express the invariant directly.
 */
export function autopilotCanSubmit(): false {
  return false;
}

export function loadAutopilotRuns(session: AppSession): AutopilotRun[] {
  const runs = readJson<AutopilotRun[]>(runsKey(session), []);
  return runs.filter((run) => autopilotRunSchema.safeParse(run).success);
}

function persistAutopilotRuns(
  session: AppSession,
  runs: AutopilotRun[]
): AutopilotRun[] {
  const parsed = runs.map((run) => autopilotRunSchema.parse(run));
  writeJson(runsKey(session), parsed.slice(0, 100));
  return parsed;
}

export function loadAutopilotActions(session: AppSession): AutopilotAction[] {
  const actions = readJson<AutopilotAction[]>(actionsKey(session), []);
  return actions.filter(
    (action) => autopilotActionSchema.safeParse(action).success
  );
}

function persistAutopilotActions(
  session: AppSession,
  actions: AutopilotAction[]
): AutopilotAction[] {
  const parsed = actions.map((action) => autopilotActionSchema.parse(action));
  writeJson(actionsKey(session), parsed.slice(0, 500));
  return parsed;
}

function audit(
  action: string,
  resourceType: string,
  resourceId: string,
  metadata: AuditMetadata = {}
): AutopilotAuditEvent {
  return { action, resourceType, resourceId, metadata };
}

export function nextScheduledAutopilotRunAt(
  settings: AutopilotSettings,
  lastRunAt: string | null,
  now: Date = new Date()
): string | null {
  if (!settings.enabled) return null;
  if (settings.runFrequency === "manual") return null;
  const intervalMs =
    settings.runFrequency === "daily"
      ? 24 * 60 * 60 * 1000
      : 6 * 60 * 60 * 1000;
  const base = lastRunAt ? new Date(lastRunAt).getTime() : now.getTime();
  return new Date(base + intervalMs).toISOString();
}

const URGENCY_RANK: Record<AutopilotActionUrgency, number> = {
  high: 0,
  medium: 1,
  low: 2
};

const TYPE_PRIORITY_RANK: Record<AutopilotActionType, number> = {
  approve_submit: 0,
  approve_browser_fill: 1,
  review_application_package: 2,
  review_high_match_job: 3,
  follow_up_due: 4,
  interview_note_needed: 5,
  add_missing_work_authorization: 6,
  add_salary_preference: 7,
  add_linkedin_url: 8,
  review_resume_warning: 9
};

/**
 * Sort actions for the Action Center. Approve-submit always sits at the
 * top regardless of caller-supplied urgency so the safety-critical user
 * decision is never buried under low-urgency missing-info prompts.
 */
export function prioritizedAutopilotActions(
  actions: AutopilotAction[]
): AutopilotAction[] {
  return [...actions]
    .filter((action) => action.status === "pending")
    .sort((a, b) => {
      // approve_submit is always first.
      const aSubmit = a.type === "approve_submit" ? 0 : 1;
      const bSubmit = b.type === "approve_submit" ? 0 : 1;
      if (aSubmit !== bSubmit) return aSubmit - bSubmit;
      const urgencyDiff = URGENCY_RANK[a.urgency] - URGENCY_RANK[b.urgency];
      if (urgencyDiff !== 0) return urgencyDiff;
      const typeDiff = TYPE_PRIORITY_RANK[a.type] - TYPE_PRIORITY_RANK[b.type];
      if (typeDiff !== 0) return typeDiff;
      return a.createdAt.localeCompare(b.createdAt);
    });
}

interface AutopilotActionInput {
  type: AutopilotActionType;
  title: string;
  reason: string;
  urgency: AutopilotActionUrgency;
  jobId?: string | null;
  applicationRecordId?: string | null;
  applicationPackageId?: string | null;
  primaryCtaLabel: string;
  primaryCtaRoute: string;
  secondaryCtaLabel?: string;
  secondaryCtaRoute?: string;
}

function buildAction(
  session: AppSession,
  input: AutopilotActionInput
): AutopilotAction {
  const timestamp = nowIso();
  return autopilotActionSchema.parse({
    id: createId("action"),
    tenantId: session.tenant.id,
    userId: session.userId,
    type: input.type,
    title: input.title,
    reason: input.reason,
    urgency: input.urgency,
    jobId: input.jobId ?? null,
    applicationRecordId: input.applicationRecordId ?? null,
    applicationPackageId: input.applicationPackageId ?? null,
    primaryCtaLabel: input.primaryCtaLabel,
    primaryCtaRoute: input.primaryCtaRoute,
    secondaryCtaLabel: input.secondaryCtaLabel ?? "",
    secondaryCtaRoute: input.secondaryCtaRoute ?? "",
    status: "pending" as AutopilotActionStatus,
    createdAt: timestamp,
    updatedAt: timestamp,
    completedAt: null,
    dismissedAt: null,
    snoozedUntil: null
  });
}

function existingActionForKey(
  actions: AutopilotAction[],
  type: AutopilotActionType,
  jobId: string | null,
  applicationRecordId: string | null,
  applicationPackageId: string | null
): AutopilotAction | undefined {
  return actions.find(
    (action) =>
      action.type === type &&
      action.status === "pending" &&
      (action.jobId ?? null) === jobId &&
      (action.applicationRecordId ?? null) === applicationRecordId &&
      (action.applicationPackageId ?? null) === applicationPackageId
  );
}

export interface UpsertAutopilotActionResult {
  action: AutopilotAction;
  actions: AutopilotAction[];
  created: boolean;
  auditEvents: AutopilotAuditEvent[];
}

/**
 * Idempotent upsert. If an open action already exists for the same
 * (type, jobId, applicationRecordId, applicationPackageId) tuple, return it
 * unchanged so successive autopilot runs do not produce duplicate items in
 * the Action Center.
 */
export function upsertAutopilotAction(
  session: AppSession,
  input: AutopilotActionInput
): UpsertAutopilotActionResult {
  const existing = loadAutopilotActions(session);
  const match = existingActionForKey(
    existing,
    input.type,
    input.jobId ?? null,
    input.applicationRecordId ?? null,
    input.applicationPackageId ?? null
  );
  if (match) {
    return {
      action: match,
      actions: existing,
      created: false,
      auditEvents: []
    };
  }
  const action = buildAction(session, input);
  const actions = persistAutopilotActions(session, [action, ...existing]);
  const auditEvents: AutopilotAuditEvent[] = [
    audit("autopilot_action_created", "AutopilotAction", action.id, {
      type: action.type,
      urgency: action.urgency,
      jobId: action.jobId ?? "",
      applicationRecordId: action.applicationRecordId ?? "",
      applicationPackageId: action.applicationPackageId ?? ""
    })
  ];
  return { action, actions, created: true, auditEvents };
}

export interface UpdateAutopilotActionResult {
  action: AutopilotAction;
  actions: AutopilotAction[];
  auditEvents: AutopilotAuditEvent[];
}

export function completeAutopilotAction(
  session: AppSession,
  actionId: string
): UpdateAutopilotActionResult {
  const existing = loadAutopilotActions(session);
  const target = existing.find((action) => action.id === actionId);
  if (!target) {
    throw new Error(`Autopilot action ${actionId} not found.`);
  }
  const timestamp = nowIso();
  const updated = autopilotActionSchema.parse({
    ...target,
    status: "completed" as AutopilotActionStatus,
    completedAt: timestamp,
    updatedAt: timestamp
  });
  const actions = persistAutopilotActions(
    session,
    existing.map((action) => (action.id === updated.id ? updated : action))
  );
  return {
    action: updated,
    actions,
    auditEvents: [
      audit("autopilot_action_completed", "AutopilotAction", updated.id, {
        type: updated.type,
        urgency: updated.urgency
      })
    ]
  };
}

export function dismissAutopilotAction(
  session: AppSession,
  actionId: string
): UpdateAutopilotActionResult {
  const existing = loadAutopilotActions(session);
  const target = existing.find((action) => action.id === actionId);
  if (!target) {
    throw new Error(`Autopilot action ${actionId} not found.`);
  }
  const timestamp = nowIso();
  const updated = autopilotActionSchema.parse({
    ...target,
    status: "dismissed" as AutopilotActionStatus,
    dismissedAt: timestamp,
    updatedAt: timestamp
  });
  const actions = persistAutopilotActions(
    session,
    existing.map((action) => (action.id === updated.id ? updated : action))
  );
  return {
    action: updated,
    actions,
    auditEvents: [
      audit("autopilot_action_dismissed", "AutopilotAction", updated.id, {
        type: updated.type
      })
    ]
  };
}

export function snoozeAutopilotAction(
  session: AppSession,
  actionId: string,
  snoozedUntil: string
): UpdateAutopilotActionResult {
  const existing = loadAutopilotActions(session);
  const target = existing.find((action) => action.id === actionId);
  if (!target) {
    throw new Error(`Autopilot action ${actionId} not found.`);
  }
  const timestamp = nowIso();
  const updated = autopilotActionSchema.parse({
    ...target,
    status: "snoozed" as AutopilotActionStatus,
    snoozedUntil,
    updatedAt: timestamp
  });
  const actions = persistAutopilotActions(
    session,
    existing.map((action) => (action.id === updated.id ? updated : action))
  );
  return {
    action: updated,
    actions,
    auditEvents: [
      audit("autopilot_action_dismissed", "AutopilotAction", updated.id, {
        type: updated.type,
        snoozedUntil
      })
    ]
  };
}

interface MissingInfoChecks {
  needsWorkAuthorization: boolean;
  needsSalary: boolean;
  needsLinkedIn: boolean;
}

function profileGapChecks(profile: UserProfile | null): MissingInfoChecks {
  if (!profile) {
    return {
      needsWorkAuthorization: true,
      needsSalary: true,
      needsLinkedIn: true
    };
  }
  return {
    needsWorkAuthorization: profile.workAuthorization.trim().length === 0,
    needsSalary: profile.salaryTarget === null || profile.salaryTarget <= 0,
    needsLinkedIn: profile.linkedinUrl.trim().length === 0
  };
}

function applicationOpenForFill(application: ApplicationRecord): boolean {
  return (
    application.status === "approved" || application.status === "draft_prepared"
  );
}

function packageReadyForReview(pkg: ApplicationPackage): boolean {
  return pkg.status === "draft" || pkg.status === "ready_for_review";
}

function packageApprovedAwaitingSubmit(pkg: ApplicationPackage): boolean {
  return pkg.status === "approved";
}

export interface RunAutopilotInput {
  triggeredBy?: AutopilotRunTrigger;
  fetcher?: typeof fetch;
}

export interface RunAutopilotResult {
  run: AutopilotRun;
  runs: AutopilotRun[];
  careerOpsRun: CareerOpsRun | null;
  careerOpsAuditEvents: CareerOpsAuditEvent[];
  actions: AutopilotAction[];
  newActionsCount: number;
  auditEvents: AutopilotAuditEvent[];
  blockedReasons: string[];
}

/**
 * Run autopilot end-to-end. Wraps Career Ops with B2C-friendly defaults,
 * then derives a small set of user-facing actions for the Action Center.
 *
 * Idempotency: package preparation is delegated to Career Ops which already
 * skips duplicates per applicationRecordId. Action creation is also
 * idempotent — see upsertAutopilotAction.
 */
export async function runAutopilot(
  session: AppSession,
  input: RunAutopilotInput = {},
  profileLoader: (session: AppSession) => UserProfile | null = (s) =>
    loadUserProfileOrNull(s)
): Promise<RunAutopilotResult> {
  const triggeredBy = input.triggeredBy ?? "manual";
  const settings = loadAutopilotSettings(session);
  const startedAt = nowIso();
  const auditEvents: AutopilotAuditEvent[] = [];

  const baseRun = autopilotRunSchema.parse({
    id: createId("autopilot_run"),
    tenantId: session.tenant.id,
    userId: session.userId,
    triggeredBy,
    status: "running",
    startedAt,
    finishedAt: null,
    careerOpsRunId: null,
    jobsScored: 0,
    highScoreJobs: 0,
    packagesPrepared: 0,
    actionsCreated: 0,
    blockedReasons: [],
    errorMessage: "",
    createdAt: startedAt,
    updatedAt: startedAt
  });
  persistAutopilotRuns(session, [baseRun, ...loadAutopilotRuns(session)]);
  auditEvents.push(
    audit("autopilot_run_started", "AutopilotRun", baseRun.id, {
      triggeredBy,
      enabled: settings.enabled
    })
  );

  const blockedReasons: string[] = [];
  const careerOpsAuditEvents: CareerOpsAuditEvent[] = [];

  // Mirror autopilot settings into Career Ops so the underlying run honours
  // the same threshold and avoid behaviours. Excluded companies are merged
  // in via the user profile in Career Ops; here we surface a warning so the
  // audit trail captures the intent for this specific run.
  saveCareerOpsSettings(session, {
    preparePackagesForHighScoreJobs:
      settings.autoPreparePackagesForHighScoreJobs &&
      !settings.requireReviewBeforePackageGeneration,
    highScoreThreshold: settings.highScoreThreshold
  });

  let careerOpsRun: CareerOpsRun | null = null;
  let packagesPrepared = 0;
  let highScoreJobs = 0;
  let jobsScored = 0;

  try {
    const careerOpsMode =
      triggeredBy === "scheduled" && settings.runFrequency !== "manual"
        ? settings.runFrequency
        : "manual";
    const result = await runCareerOps(session, {
      mode: careerOpsMode,
      fetcher: input.fetcher
    });
    careerOpsRun = result.run;
    careerOpsAuditEvents.push(...result.auditEvents);
    packagesPrepared = result.run.packagesPrepared;
    highScoreJobs = result.run.applyReviewCount;
    jobsScored = result.run.jobsScored;

    // Surface the warnings from Career Ops as autopilot blocked reasons so
    // the Action Center can show the user why packages weren't prepared.
    result.run.digestSummary.warnings.forEach((warning) => {
      const lower = warning.toLowerCase();
      if (lower.includes("avoid")) {
        blockedReasons.push(warning);
        auditEvents.push(
          audit(
            "autopilot_blocked_by_avoid_company",
            "AutopilotRun",
            baseRun.id,
            { warning }
          )
        );
      } else if (lower.includes("high-risk")) {
        blockedReasons.push(warning);
        auditEvents.push(
          audit(
            "autopilot_blocked_by_risk_signal",
            "AutopilotRun",
            baseRun.id,
            { warning }
          )
        );
      }
    });
  } catch (error) {
    const failedRun = autopilotRunSchema.parse({
      ...baseRun,
      status: "failed",
      finishedAt: nowIso(),
      errorMessage:
        error instanceof Error ? error.message : "Autopilot run failed.",
      blockedReasons,
      updatedAt: nowIso()
    });
    const runs = persistAutopilotRuns(
      session,
      loadAutopilotRuns(session).map((run) =>
        run.id === failedRun.id ? failedRun : run
      )
    );
    return {
      run: failedRun,
      runs,
      careerOpsRun: null,
      careerOpsAuditEvents,
      actions: loadAutopilotActions(session),
      newActionsCount: 0,
      auditEvents,
      blockedReasons
    };
  }

  // Derive user-facing actions from current state.
  const profile = profileLoader(session);
  const matches = loadJobMatches(session);
  const jobs = loadNormalizedJobs(session);
  const applications = loadApplications(session);
  const packages = loadApplicationPackages(session);
  const reminders = dueRemindersToday(loadFollowUpReminders(session));
  const reports = loadResumeIntelligenceReports(session);

  let newActionsCount = 0;

  // 1) High-match jobs without an application yet → review_high_match_job
  const trackedJobIds = new Set(applications.map((app) => app.jobId));
  const highMatches = matches
    .filter(
      (match) =>
        match.queue === "apply_review" &&
        match.overallScore >= settings.highScoreThreshold
    )
    .filter((match) => !trackedJobIds.has(match.jobId));
  for (const match of highMatches) {
    const job = jobs.find((item) => item.id === match.jobId);
    if (!job) continue;
    const result = upsertAutopilotAction(session, {
      type: "review_high_match_job",
      title: `${job.title} at ${job.company}`,
      reason: `Strong match (${match.overallScore.toFixed(1)} / 10). Review and decide whether to start an application.`,
      urgency: "medium",
      jobId: job.id,
      primaryCtaLabel: "Review job",
      primaryCtaRoute: "jobs",
      secondaryCtaLabel: "Open dashboard",
      secondaryCtaRoute: "dashboard"
    });
    if (result.created) newActionsCount += 1;
    auditEvents.push(...result.auditEvents);
  }

  // 2) Application packages waiting for review → review_application_package
  for (const pkg of packages) {
    if (!packageReadyForReview(pkg)) continue;
    const result = upsertAutopilotAction(session, {
      type: "review_application_package",
      title: "Application package ready to review",
      reason:
        "Autopilot prepared a package. Review it before approving the next step.",
      urgency: "high",
      jobId: pkg.jobId,
      applicationRecordId: pkg.applicationRecordId,
      applicationPackageId: pkg.id,
      primaryCtaLabel: "Review package",
      primaryCtaRoute: `package-review:${pkg.id}`,
      secondaryCtaLabel: "Open tracker",
      secondaryCtaRoute: "tracker"
    });
    if (result.created) {
      newActionsCount += 1;
      auditEvents.push(
        audit(
          "autopilot_package_prepared",
          "ApplicationPackage",
          pkg.id,
          {
            jobId: pkg.jobId,
            applicationRecordId: pkg.applicationRecordId
          }
        )
      );
    }
    auditEvents.push(...result.auditEvents);
  }

  // 3) Approved packages awaiting submit → approve_submit
  for (const pkg of packages) {
    if (!packageApprovedAwaitingSubmit(pkg)) continue;
    const application = applications.find(
      (item) => item.id === pkg.applicationRecordId
    );
    if (!application || !applicationOpenForFill(application)) continue;
    const result = upsertAutopilotAction(session, {
      type: "approve_submit",
      title: "Final submission needs your approval",
      reason:
        "Autopilot will never submit on your behalf. Open the browser session to review and approve the final submit step.",
      urgency: "high",
      jobId: pkg.jobId,
      applicationRecordId: pkg.applicationRecordId,
      applicationPackageId: pkg.id,
      primaryCtaLabel: "Review and approve",
      primaryCtaRoute: `package-review:${pkg.id}`,
      secondaryCtaLabel: "Open tracker",
      secondaryCtaRoute: "tracker"
    });
    if (result.created) newActionsCount += 1;
    auditEvents.push(...result.auditEvents);
  }

  // 4) Missing info — only when the autopilot has prepared at least one
  // package or has a high match (i.e. when the answer is actually needed).
  const needsContextualMissingInfo =
    packagesPrepared > 0 || highMatches.length > 0;
  if (needsContextualMissingInfo) {
    const gaps = profileGapChecks(profile);
    if (gaps.needsWorkAuthorization) {
      const result = upsertAutopilotAction(session, {
        type: "add_missing_work_authorization",
        title: "Add work authorization",
        reason:
          "Most applications require this answer. Adding it once unblocks the assistant for every prepared package.",
        urgency: "medium",
        primaryCtaLabel: "Update profile",
        primaryCtaRoute: "career-profile",
        secondaryCtaLabel: "Open Action Center",
        secondaryCtaRoute: "action-center"
      });
      if (result.created) {
        newActionsCount += 1;
        auditEvents.push(
          audit(
            "autopilot_missing_info_requested",
            "UserProfile",
            profile?.id ?? "profile",
            { field: "workAuthorization" }
          )
        );
      }
      auditEvents.push(...result.auditEvents);
    }
    if (gaps.needsSalary) {
      const result = upsertAutopilotAction(session, {
        type: "add_salary_preference",
        title: "Add salary preference",
        reason:
          "Compensation questions appear on most applications. Setting a salary target lets the assistant pre-fill these consistently.",
        urgency: "low",
        primaryCtaLabel: "Update profile",
        primaryCtaRoute: "career-profile",
        secondaryCtaLabel: "",
        secondaryCtaRoute: ""
      });
      if (result.created) {
        newActionsCount += 1;
        auditEvents.push(
          audit(
            "autopilot_missing_info_requested",
            "UserProfile",
            profile?.id ?? "profile",
            { field: "salaryTarget" }
          )
        );
      }
      auditEvents.push(...result.auditEvents);
    }
    if (gaps.needsLinkedIn) {
      const result = upsertAutopilotAction(session, {
        type: "add_linkedin_url",
        title: "Add LinkedIn URL",
        reason:
          "Many applications request a LinkedIn profile URL. Adding it now avoids interrupting the browser assistant later.",
        urgency: "low",
        primaryCtaLabel: "Update profile",
        primaryCtaRoute: "career-profile",
        secondaryCtaLabel: "",
        secondaryCtaRoute: ""
      });
      if (result.created) {
        newActionsCount += 1;
        auditEvents.push(
          audit(
            "autopilot_missing_info_requested",
            "UserProfile",
            profile?.id ?? "profile",
            { field: "linkedinUrl" }
          )
        );
      }
      auditEvents.push(...result.auditEvents);
    }
  }

  // 5) Resume warnings — open intelligence report with high-risk parse signals
  if (reports.length > 0) {
    const latestReport = [...reports].sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt)
    )[0];
    if (latestReport && latestReport.atsRiskLevel === "high") {
      const result = upsertAutopilotAction(session, {
        type: "review_resume_warning",
        title: "Review resume parse warnings",
        reason:
          "The latest resume intelligence pass flagged high ATS risk. Review the warnings before applying to high-priority roles.",
        urgency: "medium",
        primaryCtaLabel: "Open resume intelligence",
        primaryCtaRoute: "onboarding",
        secondaryCtaLabel: "",
        secondaryCtaRoute: ""
      });
      if (result.created) newActionsCount += 1;
      auditEvents.push(...result.auditEvents);
    }
  }

  // 6) Recruiter follow-ups due today
  for (const reminder of reminders) {
    const result = upsertAutopilotAction(session, {
      type: "follow_up_due",
      title: "Follow-up due",
      reason: reminder.reason,
      urgency: "low",
      jobId: reminder.jobId,
      applicationRecordId: reminder.applicationRecordId,
      primaryCtaLabel: "Open tracker",
      primaryCtaRoute: "tracker",
      secondaryCtaLabel: "",
      secondaryCtaRoute: ""
    });
    if (result.created) newActionsCount += 1;
    auditEvents.push(...result.auditEvents);
  }

  const finishedAt = nowIso();
  const completedRun = autopilotRunSchema.parse({
    ...baseRun,
    status: "completed",
    finishedAt,
    careerOpsRunId: careerOpsRun?.id ?? null,
    jobsScored,
    highScoreJobs,
    packagesPrepared,
    actionsCreated: newActionsCount,
    blockedReasons,
    updatedAt: finishedAt
  });
  const runs = persistAutopilotRuns(
    session,
    loadAutopilotRuns(session).map((run) =>
      run.id === completedRun.id ? completedRun : run
    )
  );
  auditEvents.push(
    audit("autopilot_run_completed", "AutopilotRun", completedRun.id, {
      jobsScored,
      highScoreJobs,
      packagesPrepared,
      actionsCreated: newActionsCount,
      blockedReasonCount: blockedReasons.length
    })
  );

  return {
    run: completedRun,
    runs,
    careerOpsRun,
    careerOpsAuditEvents,
    actions: loadAutopilotActions(session),
    newActionsCount,
    auditEvents,
    blockedReasons
  };
}

export interface AutopilotSummary {
  enabled: boolean;
  latestRun: AutopilotRun | null;
  totalRuns: number;
  nextRunAt: string | null;
  pendingActionsCount: number;
  highMatchActionsCount: number;
  packagesAwaitingReviewCount: number;
  submitApprovalsPendingCount: number;
}

export function summarizeAutopilot(
  settings: AutopilotSettings,
  runs: AutopilotRun[],
  actions: AutopilotAction[],
  now: Date = new Date()
): AutopilotSummary {
  const latestRun = runs[0] ?? null;
  const lastFinishedAt =
    runs.find((run) => run.finishedAt !== null)?.finishedAt ?? null;
  const pending = actions.filter((action) => action.status === "pending");
  return {
    enabled: settings.enabled,
    latestRun,
    totalRuns: runs.length,
    nextRunAt: nextScheduledAutopilotRunAt(settings, lastFinishedAt, now),
    pendingActionsCount: pending.length,
    highMatchActionsCount: pending.filter(
      (action) => action.type === "review_high_match_job"
    ).length,
    packagesAwaitingReviewCount: pending.filter(
      (action) => action.type === "review_application_package"
    ).length,
    submitApprovalsPendingCount: pending.filter(
      (action) => action.type === "approve_submit"
    ).length
  };
}

// Local helper so we don't pull profileService into the public type surface.
function loadUserProfileOrNull(session: AppSession): UserProfile | null {
  // Reads through the same key the profile service uses; keeping this
  // local avoids a circular import via the autopilot ↔ profile boundary.
  const stored = readJson<UserProfile | null>(
    scopedKey(session.tenant.id, session.userId, "profile"),
    null
  );
  return stored ?? null;
}

export type {
  AutopilotAction,
  AutopilotRun,
  AutopilotSettings
} from "../models/domain";

export type { JobMatch, NormalizedJob };
