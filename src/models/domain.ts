export const tenantTypes = [
  "individual",
  "career_coach",
  "university",
  "bootcamp",
  "outplacement",
  "enterprise"
] as const;

export type TenantType = (typeof tenantTypes)[number];

export const tenantPlans = ["free", "pro", "team", "enterprise"] as const;
export type TenantPlan = (typeof tenantPlans)[number];

export const tenantStatuses = ["active", "trialing", "paused", "closed"] as const;
export type TenantStatus = (typeof tenantStatuses)[number];

export const remotePreferences = ["remote", "hybrid", "onsite", "any"] as const;
export type RemotePreference = (typeof remotePreferences)[number];

export const resumeStatuses = ["uploaded", "parsed", "failed"] as const;
export type ResumeStatus = (typeof resumeStatuses)[number];

export const applicationStatuses = [
  "discovered",
  "recommended",
  "draft_prepared",
  "needs_review",
  "approved",
  "submitted",
  "recruiter_contacted",
  "interviewing",
  "rejected",
  "offer",
  "archived"
] as const;

export type ApplicationStatus = (typeof applicationStatuses)[number];

export const jobSources = [
  "greenhouse",
  "lever",
  "crawler",
  "manual",
  "api"
] as const;

export type JobSource = (typeof jobSources)[number];

export const queueTypes = ["apply_review", "maybe", "browse"] as const;
export type QueueType = (typeof queueTypes)[number];

export interface Tenant {
  id: string;
  name: string;
  type: TenantType;
  plan: TenantPlan;
  status: TenantStatus;
  createdAt: string;
}

export interface UserProfile {
  id: string;
  tenantId: string;
  userId: string;
  fullName: string;
  email: string;
  phone: string;
  location: string;
  workAuthorization: string;
  linkedinUrl: string;
  portfolioUrl: string;
  githubUrl: string;
  targetTitles: string[];
  targetLocations: string[];
  targetIndustries: string[];
  remotePreference: RemotePreference;
  salaryMin: number | null;
  salaryTarget: number | null;
  companiesToAvoid: string[];
  companiesToPrioritize: string[];
  careerSummary: string;
  verifiedFacts: string[];
  createdAt: string;
  updatedAt: string;
}

export interface Resume {
  id: string;
  tenantId: string;
  userId: string;
  originalFileName: string;
  fileUrl: string;
  parsedText: string;
  status: ResumeStatus;
  createdAt: string;
}

export interface NormalizedJob {
  id: string;
  tenantId: string;
  userId: string;
  source: JobSource;
  externalId: string;
  title: string;
  companyName: string;
  location: string;
  remotePreference: RemotePreference;
  descriptionText: string;
  applyUrl: string;
  discoveredAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface JobMatch {
  id: string;
  tenantId: string;
  userId: string;
  jobId: string;
  score: number;
  queue: QueueType;
  rationale: string;
  modelVersion: string;
  createdAt: string;
}

export interface ApplicationRecord {
  id: string;
  tenantId: string;
  userId: string;
  jobId: string;
  status: ApplicationStatus;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface AuditLog {
  id: string;
  tenantId: string;
  actorUserId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  metadata: Record<string, string | number | boolean | null>;
  createdAt: string;
}

export interface AppSession {
  tenant: Tenant;
  userId: string;
}

export interface ProfileCompletion {
  completedFields: number;
  totalFields: number;
  percent: number;
  missingFields: string[];
}
