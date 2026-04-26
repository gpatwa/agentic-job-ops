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
  "withdrawn",
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

export const browserFillModes = [
  "dry_run",
  "fill_only",
  "submit_after_approval"
] as const;

export type BrowserFillMode = (typeof browserFillModes)[number];

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

export const fillPlanActions = ["fill", "upload", "pause", "skip"] as const;
export type FillPlanAction = (typeof fillPlanActions)[number];

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

export const feedbackEventTypes = [
  "job_viewed",
  "job_saved",
  "job_rejected",
  "score_overridden",
  "application_package_generated",
  "resume_edited",
  "cover_letter_edited",
  "application_answer_edited",
  "application_package_approved",
  "application_package_rejected",
  "browser_session_created",
  "ats_adapter_run",
  "browser_submit_approved",
  "application_submitted",
  "manually_applied",
  "recruiter_response_received",
  "interview_scheduled",
  "rejected",
  "offer_received",
  "extension_session_started",
  "extension_page_analyzed",
  "extension_fill_plan_created",
  "user_approved_extension_fill",
  "extension_fields_filled",
  "extension_submit_approved",
  "extension_submit_completed",
  "extension_session_failed",
  "real_site_dry_run_started",
  "real_site_snapshot_saved",
  "real_site_snapshot_exported",
  "career_ops_run_started",
  "career_ops_run_completed",
  "career_ops_run_failed",
  "career_ops_digest_created",
  "intelligence_helpful",
  "intelligence_not_helpful",
  "risk_signal_dismissed",
  "recruiter_lead_used",
  "onboarding_target_roles_selected",
  "onboarding_jobs_recommended",
  "onboarding_application_prep_started",
  "onboarding_completed",
  "resume_profile_confirmed",
  "job_target_recommendations_confirmed",
  "job_target_recommendations_edited"
] as const;

export type FeedbackEventType = (typeof feedbackEventTypes)[number];

export const usageMeteringEventTypes = [
  "resume_uploaded",
  "job_source_created",
  "scan_run_started",
  "job_ingested",
  "job_scored",
  "application_package_generated",
  "browser_session_started",
  "ats_adapter_run",
  "browser_submit_approved",
  "application_submitted",
  "llm_tokens_used",
  "extension_session_started",
  "extension_page_analyzed",
  "extension_fill_plan_created",
  "extension_fields_filled",
  "extension_submit_approved",
  "extension_session_failed",
  "real_site_dry_run_started",
  "real_site_snapshot_saved",
  "real_site_snapshot_exported",
  "career_ops_run_started",
  "career_ops_jobs_scored",
  "career_ops_packages_prepared",
  "career_ops_digest_created",
  "company_intelligence_generated",
  "job_risk_signal_created",
  "recruiter_lead_added",
  "onboarding_target_roles_selected",
  "onboarding_jobs_recommended",
  "onboarding_application_prep_started",
  "resume_intelligence_started",
  "resume_intelligence_completed",
  "resume_fix_suggestion_created",
  "job_target_recommendations_generated",
  "job_target_recommendations_confirmed"
] as const;

export type UsageMeteringEventType = (typeof usageMeteringEventTypes)[number];

export const evalSuites = [
  "match_score",
  "application_package",
  "ats_adapter",
  "browser_assistant_safety",
  "career_ops",
  "company_intelligence",
  "onboarding",
  "resume_intelligence"
] as const;

export type EvalSuite = (typeof evalSuites)[number];

export const evalRunSuites = ["all", ...evalSuites] as const;
export type EvalRunSuite = (typeof evalRunSuites)[number];

export const evalStatuses = ["passed", "failed"] as const;
export type EvalStatus = (typeof evalStatuses)[number];

export const evalRunStatuses = ["running", "completed", "failed"] as const;
export type EvalRunStatus = (typeof evalRunStatuses)[number];

export const applicationOutcomeStatuses = [
  "recruiter_response",
  "interview_scheduled",
  "rejected",
  "offer",
  "withdrawn",
  "submitted"
] as const;

export type ApplicationOutcomeStatus = (typeof applicationOutcomeStatuses)[number];

export const aiOutputTypes = [
  "match_score",
  "application_package",
  "application_answer",
  "browser_field_mapping"
] as const;

export type AIOutputType = (typeof aiOutputTypes)[number];

export type EventMetadata = Record<string, string | number | boolean | null>;

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

export interface BrowserFillPlanItem {
  fieldId: string;
  label: string;
  action: FillPlanAction;
  source: ApplicationFieldSource;
  sourceField: string;
  valuePreview: string;
  confidence: number;
  reason: string;
}

export interface BrowserApplicationSession {
  id: string;
  tenantId: string;
  userId: string;
  jobId: string;
  applicationRecordId: string;
  applicationPackageId: string;
  atsType: BrowserAtsType;
  adapterName: string;
  adapterConfidence: number;
  fillMode: BrowserFillMode;
  status: BrowserApplicationSessionStatus;
  fieldsDetected: DetectedApplicationField[];
  fieldsFilled: FilledApplicationField[];
  uncertainFields: UncertainApplicationField[];
  fillPlan: BrowserFillPlanItem[];
  screenshotUrl: string | null;
  errorMessage: string;
  createdAt: string;
  updatedAt: string;
}

export interface FeedbackEvent {
  id: string;
  tenantId: string;
  userId: string;
  eventType: FeedbackEventType;
  resourceType: string;
  resourceId: string;
  metadata: EventMetadata;
  createdAt: string;
}

export interface EvalCase {
  id: string;
  tenantId: string;
  userId: string;
  suite: EvalSuite;
  name: string;
  description: string;
  inputSummary: string;
  expectedBehavior: string;
  createdAt: string;
}

export interface EvalRun {
  id: string;
  tenantId: string;
  userId: string;
  suite: EvalRunSuite;
  status: EvalRunStatus;
  startedAt: string;
  finishedAt: string | null;
  passCount: number;
  failCount: number;
}

export interface EvalResult {
  id: string;
  tenantId: string;
  userId: string;
  evalRunId: string;
  evalCaseId: string;
  suite: EvalSuite;
  name: string;
  status: EvalStatus;
  message: string;
  severity: "info" | "warning" | "critical";
  createdAt: string;
}

export interface UsageMeteringEvent {
  id: string;
  tenantId: string;
  userId: string;
  eventType: UsageMeteringEventType;
  resourceType: string;
  resourceId: string;
  quantity: number;
  unit: string;
  metadata: EventMetadata;
  createdAt: string;
}

export interface ApplicationOutcome {
  id: string;
  tenantId: string;
  userId: string;
  applicationRecordId: string;
  jobId: string;
  outcome: ApplicationOutcomeStatus;
  outcomeDate: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface AIOutputMetadata {
  id: string;
  tenantId: string;
  userId: string;
  outputType: AIOutputType;
  resourceType: string;
  resourceId: string;
  modelName: string;
  promptVersion: string;
  provider: string;
  mode: string;
  inputHash: string;
  outputHash: string;
  tokenInput: number;
  tokenOutput: number;
  createdAt: string;
}

export interface AuditLog {
  id: string;
  tenantId: string;
  actorUserId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  metadata: EventMetadata;
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

export const extensionSessionStatuses = [
  "extension_not_connected",
  "awaiting_user_authorization",
  "connected",
  "page_analyzed",
  "fill_plan_ready",
  "fill_approved",
  "fields_filled",
  "ready_for_final_review",
  "submit_approved",
  "submitted",
  "disconnected",
  "manual_required",
  "failed"
] as const;

export type ExtensionSessionStatus = (typeof extensionSessionStatuses)[number];

export interface ExtensionPageStructureField {
  fieldId: string;
  label: string;
  fieldType: ApplicationFieldType;
  inputName: string;
  inputId: string;
  placeholder: string;
  required: boolean;
  sensitive: boolean;
  hasValue: boolean;
}

export interface ExtensionPageStructure {
  pageUrl: string;
  pageTitle: string;
  hostname: string;
  fields: ExtensionPageStructureField[];
  hasSubmitButton: boolean;
  hasCaptcha: boolean;
  hasLoginChallenge: boolean;
  capturedAt: string;
}

export const resumeIntelligenceModes = ["deterministic", "llm"] as const;
export type ResumeIntelligenceMode = (typeof resumeIntelligenceModes)[number];

export const resumeFieldConfidences = ["high", "medium", "low"] as const;
export type ResumeFieldConfidence = (typeof resumeFieldConfidences)[number];

export const atsRiskLevels = ["low", "medium", "high"] as const;
export type AtsRiskLevel = (typeof atsRiskLevels)[number];

export const recommendedRoleFitLevels = [
  "strong",
  "adjacent",
  "stretch",
  "avoid"
] as const;
export type RecommendedRoleFitLevel = (typeof recommendedRoleFitLevels)[number];

export const skillGapImportances = ["high", "medium", "low"] as const;
export type SkillGapImportance = (typeof skillGapImportances)[number];

export interface ExtractedResumeProfile {
  fullName: string;
  email: string;
  phone: string;
  location: string;
  linkedinUrl: string;
  githubUrl: string;
  portfolioUrl: string;
  currentTitle: string;
  seniorityLevel: string;
  yearsOfExperience: number | null;
  industries: string[];
  companies: string[];
  jobTitles: string[];
  education: string[];
  certifications: string[];
  skills: string[];
  tools: string[];
  projects: string[];
  leadershipExamples: string[];
  quantifiedAchievements: string[];
  workAuthorization: string;
  resumeStrengths: string[];
  resumeGaps: string[];
}

export interface ResumeFieldConfidenceMap {
  fullName: ResumeFieldConfidence;
  email: ResumeFieldConfidence;
  phone: ResumeFieldConfidence;
  location: ResumeFieldConfidence;
  linkedinUrl: ResumeFieldConfidence;
  githubUrl: ResumeFieldConfidence;
  portfolioUrl: ResumeFieldConfidence;
  currentTitle: ResumeFieldConfidence;
  seniorityLevel: ResumeFieldConfidence;
  yearsOfExperience: ResumeFieldConfidence;
  skills: ResumeFieldConfidence;
  industries: ResumeFieldConfidence;
}

export interface ResumeIntelligenceSuggestedFix {
  field: string;
  severity: AtsRiskLevel;
  message: string;
  recommendedAction: string;
}

export interface ResumeIntelligenceReport {
  id: string;
  tenantId: string;
  userId: string;
  resumeId: string;
  extractionMode: ResumeIntelligenceMode;
  modelName: string;
  promptVersion: string;
  extractedProfile: ExtractedResumeProfile;
  confidenceByField: ResumeFieldConfidenceMap;
  missingFields: string[];
  ambiguousFields: string[];
  parsingWarnings: string[];
  atsRiskScore: number;
  atsRiskLevel: AtsRiskLevel;
  suggestedFixes: ResumeIntelligenceSuggestedFix[];
  createdAt: string;
  updatedAt: string;
}

export interface RecommendedRole {
  title: string;
  fitLevel: RecommendedRoleFitLevel;
  confidence: ResumeFieldConfidence;
  why: string;
  evidenceFromResume: string[];
  searchKeywords: string[];
  suggestedResumeAngle: string;
}

export interface SkillGap {
  skill: string;
  importance: SkillGapImportance;
  reason: string;
  howToClose: string;
}

export interface JobTargetRecommendation {
  id: string;
  tenantId: string;
  userId: string;
  resumeId: string;
  reportId: string;
  strongestRoles: RecommendedRole[];
  adjacentRoles: RecommendedRole[];
  stretchRoles: RecommendedRole[];
  rolesToAvoid: RecommendedRole[];
  recommendedIndustries: string[];
  recommendedSeniority: string;
  recommendedSearchKeywords: string[];
  positioningSummary: string;
  resumePositioningAdvice: string[];
  skillGaps: SkillGap[];
  confidence: ResumeFieldConfidence;
  extractionMode: ResumeIntelligenceMode;
  modelName: string;
  promptVersion: string;
  createdAt: string;
  updatedAt: string;
}

export interface OnboardingState {
  id: string;
  tenantId: string;
  userId: string;
  selectedTargetRoles: string[];
  onboardingJobsGenerated: boolean;
  onboardingJobsScored: boolean;
  firstApplyReadyJobsShown: boolean;
  firstJobReviewed: boolean;
  onboardingCompletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export const intelligenceSources = [
  "deterministic",
  "llm",
  "external_api",
  "manual"
] as const;
export type IntelligenceSource = (typeof intelligenceSources)[number];

export const intelligenceConfidences = ["high", "medium", "low"] as const;
export type IntelligenceConfidence = (typeof intelligenceConfidences)[number];

export const jobRiskSignalTypes = [
  "suspicious_domain",
  "unrealistic_salary",
  "vague_description",
  "fee_request",
  "non_company_email",
  "stale_or_reposted",
  "mismatched_ats_domain",
  "low_company_confidence",
  "unknown"
] as const;
export type JobRiskSignalType = (typeof jobRiskSignalTypes)[number];

export const jobRiskSeverities = ["low", "medium", "high"] as const;
export type JobRiskSeverity = (typeof jobRiskSeverities)[number];

export interface CompanyIntelligence {
  id: string;
  tenantId: string;
  userId: string;
  jobId: string;
  company: string;
  summary: string;
  businessModel: string;
  industry: string;
  companySize: string;
  fundingStage: string;
  recentSignals: string[];
  whyThisCompany: string;
  interviewPrepNotes: string[];
  compensationSignals: string;
  referralStrategy: string;
  source: IntelligenceSource;
  confidence: IntelligenceConfidence;
  createdAt: string;
  updatedAt: string;
}

export interface RecruiterLead {
  id: string;
  tenantId: string;
  userId: string;
  jobId: string;
  company: string;
  name: string;
  title: string;
  publicProfileUrl: string;
  source: IntelligenceSource;
  confidence: IntelligenceConfidence;
  outreachSuggestion: string;
  createdAt: string;
}

export interface JobRiskSignal {
  id: string;
  tenantId: string;
  userId: string;
  jobId: string;
  riskType: JobRiskSignalType;
  severity: JobRiskSeverity;
  explanation: string;
  recommendedAction: string;
  createdAt: string;
}

export const careerOpsRunModes = ["manual", "daily", "every_6_hours"] as const;
export type CareerOpsRunMode = (typeof careerOpsRunModes)[number];

export const careerOpsRunStatuses = [
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled"
] as const;
export type CareerOpsRunStatus = (typeof careerOpsRunStatuses)[number];

export const careerOpsScheduleModes = [
  "disabled",
  "manual_only",
  "daily",
  "every_6_hours"
] as const;
export type CareerOpsScheduleMode = (typeof careerOpsScheduleModes)[number];

export interface CareerOpsSettings {
  id: string;
  tenantId: string;
  userId: string;
  scheduleMode: CareerOpsScheduleMode;
  preparePackagesForHighScoreJobs: boolean;
  highScoreThreshold: number;
  overrideHighRiskPackagePrep: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CareerOpsDigestSummary {
  jobsFound: number;
  highMatches: number;
  mediumMatches: number;
  lowMatches: number;
  packagesPrepared: number;
  recommendedNextAction: string;
  warnings: string[];
  lines: string[];
}

export interface CareerOpsRun {
  id: string;
  tenantId: string;
  userId: string;
  mode: CareerOpsRunMode;
  status: CareerOpsRunStatus;
  startedAt: string;
  completedAt: string | null;
  ingestionRunIds: string[];
  jobsFound: number;
  jobsInserted: number;
  jobsUpdated: number;
  duplicatesFound: number;
  jobsScored: number;
  applyReviewCount: number;
  maybeCount: number;
  browseCount: number;
  packagesPrepared: number;
  digestSummary: CareerOpsDigestSummary;
  errorMessage: string;
  createdAt: string;
  updatedAt: string;
}

export interface RealSiteValidationSummary {
  adapterDetectedCorrectly: boolean;
  requiredFieldsFound: boolean;
  safeFieldsMapped: boolean;
  uncertainFieldsPaused: boolean;
  sensitiveFieldsPaused: boolean;
  submitBlocked: boolean;
}

export interface RealSiteDryRunSnapshot {
  id: string;
  tenantId: string;
  userId: string;
  sourceUrl: string;
  redactedUrl: string;
  hostname: string;
  atsType: BrowserAtsType;
  adapterConfidence: number;
  pageTitle: string;
  detectedFieldCount: number;
  requiredFieldCount: number;
  safeFillCount: number;
  pausedFieldCount: number;
  sensitiveFieldCount: number;
  submitButtonCount: number;
  submitBlocked: boolean;
  submitBlockedReason: string;
  validationSummary: RealSiteValidationSummary;
  source: "extension_session" | "url_only";
  extensionSessionId: string | null;
  createdAt: string;
}

export interface ExtensionSession {
  id: string;
  tenantId: string;
  userId: string;
  extensionInstanceId: string;
  pageUrl: string;
  pageTitle: string;
  hostname: string;
  status: ExtensionSessionStatus;
  applicationPackageId: string | null;
  applicationRecordId: string | null;
  jobId: string | null;
  browserApplicationSessionId: string | null;
  fieldsDetected: DetectedApplicationField[];
  fieldsFilled: FilledApplicationField[];
  uncertainFields: UncertainApplicationField[];
  fillPlan: BrowserFillPlanItem[];
  pageStructureHash: string;
  authorizedAt: string | null;
  fillApprovedAt: string | null;
  submitApprovedAt: string | null;
  submittedAt: string | null;
  disconnectedAt: string | null;
  errorMessage: string;
  createdAt: string;
  updatedAt: string;
}
