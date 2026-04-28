import type {
  AppSession,
  AuditLog,
  JobMatch,
  NormalizedJob,
  OnboardingState,
  UserProfile
} from "../models/domain";
import {
  normalizedJobSchema,
  onboardingStateSchema
} from "../models/schemas";
import { readJson, scopedKey, writeJson } from "../lib/storage";
import {
  loadNormalizedJobs,
  saveNormalizedJobs
} from "./jobIngestion";
import { loadJobMatches, scoreJobsForProfile } from "./matchEngine";

type AuditMetadata = AuditLog["metadata"];

/**
 * Onboarding job recommendation service.
 *
 * - Helps the candidate finish onboarding with a list of jobs they can act on.
 * - Demo jobs are persisted alongside real jobs but use a `demo_job_` id
 *   prefix so the UI can label them clearly. The service never invents
 *   candidate experience and never submits applications.
 */

export interface OnboardingAuditEvent {
  action: string;
  resourceType: string;
  resourceId: string;
  metadata: AuditMetadata;
}

export interface OnboardingRecommendationGroup {
  label: "Strong matches" | "Possible matches" | "Browse / lower matches";
  matches: Array<{ match: JobMatch; job: NormalizedJob; isDemo: boolean }>;
}

export interface OnboardingRecommendationResult {
  state: OnboardingState;
  matches: JobMatch[];
  jobs: NormalizedJob[];
  groups: OnboardingRecommendationGroup[];
  demoJobsCreated: number;
  showsDemoBanner: boolean;
  auditEvents: OnboardingAuditEvent[];
}

const DEMO_JOB_ID_PREFIX = "demo_job_";

function nowIso(): string {
  return new Date().toISOString();
}

function createId(prefix: string): string {
  return `${prefix}_${globalThis.crypto.randomUUID()}`;
}

function onboardingKey(session: AppSession): string {
  return scopedKey(session.tenant.id, session.userId, "onboarding_state");
}

export function isDemoJob(job: NormalizedJob): boolean {
  return job.id.startsWith(DEMO_JOB_ID_PREFIX);
}

export function defaultOnboardingState(session: AppSession): OnboardingState {
  const timestamp = nowIso();
  return onboardingStateSchema.parse({
    id: `onboarding_${session.tenant.id}_${session.userId}`,
    tenantId: session.tenant.id,
    userId: session.userId,
    selectedTargetRoles: [],
    onboardingJobsGenerated: false,
    onboardingJobsScored: false,
    firstApplyReadyJobsShown: false,
    firstJobReviewed: false,
    onboardingCompletedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp
  });
}

export function loadOnboardingState(session: AppSession): OnboardingState {
  const stored = readJson<OnboardingState | null>(onboardingKey(session), null);
  if (!stored) {
    const defaults = defaultOnboardingState(session);
    writeJson(onboardingKey(session), defaults);
    return defaults;
  }
  const parsed = onboardingStateSchema.safeParse(stored);
  if (!parsed.success) {
    const defaults = defaultOnboardingState(session);
    writeJson(onboardingKey(session), defaults);
    return defaults;
  }
  return parsed.data;
}

export function saveOnboardingState(
  session: AppSession,
  next: Partial<Omit<OnboardingState, "id" | "tenantId" | "userId" | "createdAt">>
): OnboardingState {
  const existing = loadOnboardingState(session);
  const merged = onboardingStateSchema.parse({
    ...existing,
    ...next,
    updatedAt: nowIso()
  });
  writeJson(onboardingKey(session), merged);
  return merged;
}

interface DemoJobTemplate {
  keywords: string[];
  title: string;
  company: string;
  location: string;
  description: string;
  responsibilities: string[];
  requirements: string[];
  salaryMin: number;
  salaryMax: number;
}

const DEMO_JOB_LIBRARY: DemoJobTemplate[] = [
  {
    keywords: ["product manager", "product", "pm", "product lead"],
    title: "Senior Product Manager",
    company: "DemoLabs",
    location: "Remote (US)",
    description:
      "[Demo job] DemoLabs is hiring a Senior Product Manager for B2B SaaS workflow automation, customer discovery, roadmap delivery, and cross-functional execution with engineering and design partners.",
    responsibilities: [
      "Lead customer discovery interviews",
      "Partner with engineering and design on roadmap delivery",
      "Launch workflow automation product surfaces"
    ],
    requirements: [
      "5+ years in B2B SaaS product management",
      "Hands-on experience launching workflow automation features",
      "Strong customer-discovery and prioritisation track record"
    ],
    salaryMin: 160000,
    salaryMax: 200000
  },
  {
    keywords: ["data scientist", "data analyst", "ml", "machine learning", "analytics"],
    title: "Senior Data Scientist",
    company: "DemoData",
    location: "Remote (Worldwide)",
    description:
      "[Demo job] DemoData is hiring a Senior Data Scientist to drive product analytics, build experimentation pipelines, and partner with product on growth and retention.",
    responsibilities: [
      "Design product experiments and analyse results",
      "Build production-grade analytics pipelines",
      "Mentor analysts and partner with engineering"
    ],
    requirements: [
      "4+ years in product analytics or data science",
      "Strong SQL and Python experience",
      "Experimentation and causal inference background"
    ],
    salaryMin: 150000,
    salaryMax: 195000
  },
  {
    keywords: ["software engineer", "engineer", "developer", "backend", "fullstack"],
    title: "Senior Software Engineer",
    company: "DemoEngine",
    location: "Hybrid (NYC)",
    description:
      "[Demo job] DemoEngine is hiring a Senior Software Engineer to ship a TypeScript-first product platform, partner with design on customer-facing features, and improve engineering rigor across the team.",
    responsibilities: [
      "Ship customer-facing features in TypeScript",
      "Partner with design and product on roadmap delivery",
      "Mentor engineers and improve engineering practices"
    ],
    requirements: [
      "5+ years building production-grade web apps",
      "Strong TypeScript and React experience",
      "Comfortable owning a service end-to-end"
    ],
    salaryMin: 165000,
    salaryMax: 215000
  },
  {
    keywords: ["designer", "design", "ux", "ui", "product designer"],
    title: "Senior Product Designer",
    company: "DemoCraft",
    location: "Remote (EU)",
    description:
      "[Demo job] DemoCraft is hiring a Senior Product Designer to lead workflow design across the B2B platform, partner with research, and ship craft-led experiences.",
    responsibilities: [
      "Lead end-to-end design for workflow features",
      "Partner with research on customer discovery",
      "Set craft and design-system standards"
    ],
    requirements: [
      "5+ years in product design at B2B SaaS",
      "Strong portfolio with workflow tools",
      "Excellent partnership skills with PM and engineering"
    ],
    salaryMin: 140000,
    salaryMax: 180000
  },
  {
    keywords: ["growth", "marketing", "demand"],
    title: "Growth Marketing Lead",
    company: "DemoSignal",
    location: "Remote (US)",
    description:
      "[Demo job] DemoSignal is hiring a Growth Marketing Lead to own demand generation, lifecycle programs, and experimentation across the B2B funnel.",
    responsibilities: [
      "Own demand generation strategy",
      "Run experimentation across the funnel",
      "Partner with product on lifecycle programs"
    ],
    requirements: [
      "5+ years in B2B SaaS growth marketing",
      "Hands-on experimentation experience",
      "Strong cross-functional collaboration"
    ],
    salaryMin: 145000,
    salaryMax: 185000
  },
  {
    keywords: ["operations", "ops", "program manager"],
    title: "Senior Operations Manager",
    company: "DemoOps",
    location: "Remote (US)",
    description:
      "[Demo job] DemoOps is hiring a Senior Operations Manager to scale internal ops, manage cross-team programs, and partner with finance and people teams.",
    responsibilities: [
      "Scale operational systems across the company",
      "Manage cross-functional programs",
      "Partner with finance and people teams"
    ],
    requirements: [
      "5+ years in operations or program management",
      "Strong operational rigor",
      "Excellent communication"
    ],
    salaryMin: 130000,
    salaryMax: 170000
  }
];

function templateMatchesRole(template: DemoJobTemplate, role: string): boolean {
  const lower = role.toLowerCase();
  return template.keywords.some((keyword) => lower.includes(keyword));
}

function buildDemoJob(
  session: AppSession,
  template: DemoJobTemplate,
  index: number
): NormalizedJob {
  const timestamp = nowIso();
  const slug = template.title.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
  return normalizedJobSchema.parse({
    id: `${DEMO_JOB_ID_PREFIX}${slug}_${index}`,
    tenantId: session.tenant.id,
    userId: session.userId,
    sourceConfigId: null,
    source: "manual",
    sourceJobId: `demo_${slug}_${index}`,
    title: template.title,
    company: template.company,
    location: template.location,
    remoteType: template.location.toLowerCase().includes("remote") ? "remote" : "hybrid",
    salaryMin: template.salaryMin,
    salaryMax: template.salaryMax,
    description: template.description,
    responsibilities: template.responsibilities,
    requirements: template.requirements,
    applicationUrl: `https://demo.local/jobs/${slug}_${index}`,
    atsType: "manual",
    postedAt: timestamp,
    discoveredAt: timestamp,
    scoringStatus: "queued",
    createdAt: timestamp,
    updatedAt: timestamp
  });
}

function jobMatchesAnyRole(job: NormalizedJob, roles: string[]): boolean {
  if (roles.length === 0) return false;
  const haystack = `${job.title} ${job.description}`.toLowerCase();
  return roles.some((role) => {
    const lower = role.toLowerCase().trim();
    if (!lower) return false;
    return haystack.includes(lower);
  });
}

function groupRecommendations(
  matches: JobMatch[],
  jobs: NormalizedJob[]
): OnboardingRecommendationGroup[] {
  const jobById = new Map(jobs.map((job) => [job.id, job] as const));
  const strong = matches
    .filter((match) => match.queue === "apply_review")
    .map((match) => ({
      match,
      job: jobById.get(match.jobId) ?? null,
      isDemo: jobById.get(match.jobId) ? isDemoJob(jobById.get(match.jobId)!) : false
    }))
    .filter((entry): entry is { match: JobMatch; job: NormalizedJob; isDemo: boolean } =>
      Boolean(entry.job)
    )
    .sort((a, b) => b.match.overallScore - a.match.overallScore);
  const possible = matches
    .filter((match) => match.queue === "maybe")
    .map((match) => ({
      match,
      job: jobById.get(match.jobId) ?? null,
      isDemo: jobById.get(match.jobId) ? isDemoJob(jobById.get(match.jobId)!) : false
    }))
    .filter((entry): entry is { match: JobMatch; job: NormalizedJob; isDemo: boolean } =>
      Boolean(entry.job)
    )
    .sort((a, b) => b.match.overallScore - a.match.overallScore);
  const browse = matches
    .filter((match) => match.queue === "browse")
    .map((match) => ({
      match,
      job: jobById.get(match.jobId) ?? null,
      isDemo: jobById.get(match.jobId) ? isDemoJob(jobById.get(match.jobId)!) : false
    }))
    .filter((entry): entry is { match: JobMatch; job: NormalizedJob; isDemo: boolean } =>
      Boolean(entry.job)
    )
    .sort((a, b) => b.match.overallScore - a.match.overallScore);

  return [
    { label: "Strong matches", matches: strong },
    { label: "Possible matches", matches: possible },
    { label: "Browse / lower matches", matches: browse }
  ];
}

function event(
  action: string,
  state: OnboardingState,
  metadata: AuditMetadata = {}
): OnboardingAuditEvent {
  return {
    action,
    resourceType: "OnboardingState",
    resourceId: state.id,
    metadata: {
      selectedTargetRoleCount: state.selectedTargetRoles.length,
      ...metadata
    }
  };
}

export interface RecommendForOnboardingInput {
  targetRoles: string[];
  profile: UserProfile | null;
  allowDemoJobs?: boolean;
  maxDemoJobs?: number;
}

export async function recordTargetRolesSelected(
  session: AppSession,
  targetRoles: string[]
): Promise<{ state: OnboardingState; auditEvents: OnboardingAuditEvent[] }> {
  const cleaned = Array.from(
    new Set(
      targetRoles
        .map((role) => role.trim())
        .filter((role) => role.length > 0)
    )
  );
  const state = saveOnboardingState(session, {
    selectedTargetRoles: cleaned
  });
  return {
    state,
    auditEvents: [
      event("onboarding_target_roles_selected", state, {
        roleCount: cleaned.length
      })
    ]
  };
}

export async function recommendApplyReadyJobs(
  session: AppSession,
  input: RecommendForOnboardingInput
): Promise<OnboardingRecommendationResult> {
  const allowDemo = input.allowDemoJobs !== false;
  const maxDemoJobs = input.maxDemoJobs ?? 3;
  const auditEvents: OnboardingAuditEvent[] = [];

  let state = loadOnboardingState(session);
  if (input.targetRoles.length > 0) {
    const updated = await recordTargetRolesSelected(session, input.targetRoles);
    state = updated.state;
    auditEvents.push(...updated.auditEvents);
  }

  const allJobs = loadNormalizedJobs(session);
  const matchingExisting = allJobs.filter((job) =>
    jobMatchesAnyRole(job, state.selectedTargetRoles)
  );

  let demoJobsCreated = 0;
  let workingJobs = matchingExisting;

  if (matchingExisting.length === 0 && allowDemo && state.selectedTargetRoles.length > 0) {
    const seededDemoIds = new Set(allJobs.filter(isDemoJob).map((job) => job.id));
    const newDemoJobs: NormalizedJob[] = [];
    for (const role of state.selectedTargetRoles) {
      const matchingTemplates = DEMO_JOB_LIBRARY.filter((template) =>
        templateMatchesRole(template, role)
      );
      if (matchingTemplates.length === 0) {
        // Skip this role — no plausible template in the local
        // demo catalog. Previously we fell back to
        // DEMO_JOB_LIBRARY[0] (a Product Manager template) so
        // the user always saw at least one demo job. That
        // produced the off-target "Senior Software Engineer at
        // DemoEngine" recommendations on a senior leadership
        // resume — confusing more than it helped. With the
        // fallback dropped, the recommendations panel renders
        // the honest "We couldn't find a great match — add a
        // job source" empty state instead.
        continue;
      }
      for (const template of matchingTemplates) {
        if (newDemoJobs.length >= maxDemoJobs) break;
        const candidate = buildDemoJob(session, template, newDemoJobs.length + 1);
        if (seededDemoIds.has(candidate.id)) continue;
        seededDemoIds.add(candidate.id);
        newDemoJobs.push(candidate);
      }
      if (newDemoJobs.length >= maxDemoJobs) break;
    }
    if (newDemoJobs.length > 0) {
      const merged = [...newDemoJobs, ...allJobs];
      saveNormalizedJobs(session, merged);
      workingJobs = newDemoJobs;
      demoJobsCreated = newDemoJobs.length;
      auditEvents.push(
        event("onboarding_demo_jobs_created", state, {
          demoJobsCreated,
          rolesCount: state.selectedTargetRoles.length
        })
      );
    }
  }

  state = saveOnboardingState(session, {
    onboardingJobsGenerated: true
  });

  const existingMatches = loadJobMatches(session);
  const scoring = await scoreJobsForProfile(
    session,
    input.profile,
    workingJobs,
    existingMatches
  );

  state = saveOnboardingState(session, {
    onboardingJobsScored: true,
    firstApplyReadyJobsShown: true
  });

  const matchedIds = new Set(workingJobs.map((job) => job.id));
  const matchesForRecommendations = scoring.matches.filter((match) =>
    matchedIds.has(match.jobId)
  );
  const groups = groupRecommendations(matchesForRecommendations, workingJobs);
  // Only flag the "demo jobs are shown" banner when EVERY visible
  // job is a demo. Once the LLM-driven company discovery has
  // ingested real jobs from the curated catalog, the demo banner
  // is misleading — the platform has real sources configured.
  const showsDemoBanner =
    workingJobs.length > 0 && workingJobs.every(isDemoJob);

  auditEvents.push(
    event("onboarding_jobs_recommended", state, {
      strongCount: groups[0].matches.length,
      possibleCount: groups[1].matches.length,
      browseCount: groups[2].matches.length,
      demoJobsShown: showsDemoBanner ? demoJobsCreated : 0
    })
  );

  return {
    state,
    matches: matchesForRecommendations,
    jobs: workingJobs,
    groups,
    demoJobsCreated,
    showsDemoBanner,
    auditEvents
  };
}

export async function recordOnboardingJobReviewed(
  session: AppSession,
  jobId: string
): Promise<{ state: OnboardingState; auditEvents: OnboardingAuditEvent[] }> {
  const state = saveOnboardingState(session, {
    firstJobReviewed: true
  });
  return {
    state,
    auditEvents: [
      event("onboarding_job_review_started", state, { jobId })
    ]
  };
}

export async function recordOnboardingApplicationPrepStarted(
  session: AppSession,
  jobId: string
): Promise<{ state: OnboardingState; auditEvents: OnboardingAuditEvent[] }> {
  const state = saveOnboardingState(session, {
    firstJobReviewed: true
  });
  return {
    state,
    auditEvents: [
      event("onboarding_application_prep_started", state, { jobId })
    ]
  };
}

export async function recordOnboardingCompleted(
  session: AppSession,
  reason: "user_chose_dashboard" | "user_started_review" | "user_started_prep"
): Promise<{ state: OnboardingState; auditEvents: OnboardingAuditEvent[] }> {
  const existing = loadOnboardingState(session);
  if (existing.onboardingCompletedAt) {
    return {
      state: existing,
      auditEvents: []
    };
  }
  const state = saveOnboardingState(session, {
    onboardingCompletedAt: nowIso()
  });
  return {
    state,
    auditEvents: [
      event("onboarding_completed", state, { reason })
    ]
  };
}

export function isOnboardingComplete(state: OnboardingState): boolean {
  if (state.onboardingCompletedAt) return true;
  return Boolean(
    state.selectedTargetRoles.length > 0 &&
      state.firstApplyReadyJobsShown &&
      state.firstJobReviewed
  );
}

export type { OnboardingState };
