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

export const jobRemoteTypes = ["remote", "hybrid", "onsite", "unknown"] as const;
export type JobRemoteType = (typeof jobRemoteTypes)[number];

export const resumeStatuses = ["uploaded", "parsed", "failed"] as const;
export type ResumeStatus = (typeof resumeStatuses)[number];

export const applicationStatuses = [
  "discovered",
  "recommended",
  "saved",
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

export const dashboardJobActions = [
  "save_for_later",
  "reject",
  "archive",
  "move_to_apply_review",
  "move_to_maybe",
  "start_application_prep",
  "update_notes",
  "mark_manually_applied",
  "mark_not_interested"
] as const;

export type DashboardJobAction = (typeof dashboardJobActions)[number];

export const applicationPackageStatuses = [
  "draft",
  "ready_for_review",
  "approved",
  "rejected"
] as const;

export type ApplicationPackageStatus = (typeof applicationPackageStatuses)[number];

export const generationModes = ["deterministic", "llm"] as const;
export type GenerationMode = (typeof generationModes)[number];

export const answerConfidences = ["high", "medium", "low"] as const;
export type AnswerConfidence = (typeof answerConfidences)[number];

export const applicationAnswerSources = ["generated", "user_edited"] as const;
export type ApplicationAnswerSource = (typeof applicationAnswerSources)[number];

export const jobSources = [
  "greenhouse",
  "lever",
  "crawler",
  "manual",
  "api"
] as const;

export type JobSource = (typeof jobSources)[number];

export const atsTypes = ["greenhouse", "lever", "manual", "crawler", "api"] as const;
export type AtsType = (typeof atsTypes)[number];

export const browserAtsTypes = [
  "greenhouse",
  "lever",
  "ashby",
  "workday",
  "linkedin",
  "custom",
  "unknown"
] as const;

export type BrowserAtsType = (typeof browserAtsTypes)[number];

export const browserApplicationSessionStatuses = [
  "queued",
  "opening",
  "detecting_ats",
  "detecting_form",
  "filling",
  "needs_user_input",
  "ready_for_review",
  "approved_for_submit",
  "submitted",
  "failed",
  "manual_required"
] as const;

export type BrowserApplicationSessionStatus =
  (typeof browserApplicationSessionStatuses)[number];

export const applicationFieldTypes = [
  "text",
  "email",
  "phone",
  "url",
  "file",
  "textarea",
  "select",
  "checkbox",
  "captcha",
  "unknown"
] as const;

export type ApplicationFieldType = (typeof applicationFieldTypes)[number];

export const applicationFieldSources = [
  "profile",
  "resume",
  "application_package",
  "application_answer",
  "user_required",
  "none"
] as const;

export type ApplicationFieldSource = (typeof applicationFieldSources)[number];

export const uncertainFieldReasons = [
  "captcha",
  "login_challenge",
  "salary_missing",
  "demographic",
  "sensitive",
  "unclear_required",
  "low_confidence",
  "final_submit",
  "unknown"
] as const;

export type UncertainFieldReason = (typeof uncertainFieldReasons)[number];

export const scanSchedules = ["manual", "daily", "every_6_hours"] as const;
export type ScanSchedule = (typeof scanSchedules)[number];

export const scanRunStatuses = ["running", "succeeded", "failed"] as const;
export type ScanRunStatus = (typeof scanRunStatuses)[number];

export const scoringStatuses = ["queued", "scored", "skipped"] as const;
export type ScoringStatus = (typeof scoringStatuses)[number];

export const queueTypes = ["apply_review", "maybe", "browse"] as const;
export type QueueType = (typeof queueTypes)[number];

export const matchRecommendations = ["apply", "maybe", "browse", "skip"] as const;
export type MatchRecommendation = (typeof matchRecommendations)[number];

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
  sourceConfigId: string | null;
  source: JobSource;
  sourceJobId: string;
  title: string;
  company: string;
  location: string;
  remoteType: JobRemoteType;
  salaryMin: number | null;
  salaryMax: number | null;
  description: string;
  responsibilities: string[];
  requirements: string[];
  applicationUrl: string;
  atsType: AtsType;
  postedAt: string | null;
  discoveredAt: string;
  scoringStatus: ScoringStatus;
  createdAt: string;
  updatedAt: string;
}

export interface JobSourceConfig {
  id: string;
  tenantId: string;
  userId: string;
  source: JobSource;
  displayName: string;
  companyName: string;
  boardToken: string;
  siteName: string;
  manualUrl: string;
  schedule: ScanSchedule;
  enabled: boolean;
  lastScanAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ScanRun {
  id: string;
  tenantId: string;
  userId: string;
  sourceConfigId: string;
  source: JobSource;
  status: ScanRunStatus;
  startedAt: string;
  finishedAt: string | null;
  jobsFetched: number;
  jobsInserted: number;
  jobsUpdated: number;
  duplicatesSkipped: number;
  errorMessage: string;
}

export interface MatchScore {
  id: string;
  tenantId: string;
  userId: string;
  jobId: string;
  overallScore: number;
  skillsScore: number;
  experienceScore: number;
  seniorityScore: number;
  locationScore: number;
  salaryScore: number;
  industryScore: number;
  companyFitScore: number;
  applicationEffortScore: number;
  strategicValueScore: number;
  recommendation: MatchRecommendation;
  topMatchReasons: string[];
  topGaps: string[];
  employerLookingFor: string[];
  summary: string;
  recommendedNextAction: string;
  scoringVersion: string;
  modelName: string;
  promptVersion: string;
  createdAt: string;
  updatedAt: string;
}

export interface JobMatch extends MatchScore {
  queue: QueueType;
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

export interface ApplicationPackage {
  id: string;
  tenantId: string;
  userId: string;
  jobId: string;
  applicationRecordId: string;
  status: ApplicationPackageStatus;
  resumeMarkdown: string;
  coverLetter: string;
  generationMode: GenerationMode;
  modelName: string;
  promptVersion: string;
  inputHash: string;
  outputHash: string;
  safetyWarnings: string[];
  createdAt: string;
  updatedAt: string;
  approvedAt: string | null;
  rejectedAt: string | null;
}

export interface ApplicationAnswer {
  id: string;
  tenantId: string;
  userId: string;
  applicationPackageId: string;
  question: string;
  answer: string;
  confidence: AnswerConfidence;
  source: ApplicationAnswerSource;
  needsUserReview: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface DetectedApplicationField {
  id: string;
  label: string;
  fieldType: ApplicationFieldType;
  required: boolean;
  sensitive: boolean;
  confidence: number;
  source: ApplicationFieldSource;
  sourceField: string;
}

export interface FilledApplicationField {
  fieldId: string;
  label: string;
  source: ApplicationFieldSource;
  sourceField: string;
  valuePreview: string;
  confidence: number;
}

export interface UncertainApplicationField {
  fieldId: string;
  label: string;
  reason: UncertainFieldReason;
  required: boolean;
  guidance: string;
}

export interface BrowserApplicationSession {
  id: string;
  tenantId: string;
  userId: string;
  jobId: string;
  applicationRecordId: string;
  applicationPackageId: string;
  atsType: BrowserAtsType;
  status: BrowserApplicationSessionStatus;
  fieldsDetected: DetectedApplicationField[];
  fieldsFilled: FilledApplicationField[];
  uncertainFields: UncertainApplicationField[];
  screenshotUrl: string | null;
  errorMessage: string;
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
