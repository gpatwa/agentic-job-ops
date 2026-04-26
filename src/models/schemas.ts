import { z } from "zod";
import {
  answerConfidences,
  applicationAnswerSources,
  applicationFieldSources,
  applicationOutcomeStatuses,
  applicationFieldTypes,
  applicationPackageStatuses,
  applicationStatuses,
  atsTypes,
  aiOutputTypes,
  browserFillModes,
  browserApplicationSessionStatuses,
  browserAtsTypes,
  careerOpsRunModes,
  careerOpsRunStatuses,
  careerOpsScheduleModes,
  atsRiskLevels,
  intelligenceConfidences,
  intelligenceSources,
  jobRiskSeverities,
  jobRiskSignalTypes,
  followUpReminderStatuses,
  interviewStages,
  outreachDraftStatuses,
  outreachDraftTypes,
  recommendedRoleFitLevels,
  recruiterContactConfidences,
  recruiterContactSources,
  resumeFieldConfidences,
  resumeImprovementStatuses,
  resumeIntelligenceModes,
  skillGapImportances,
  evalRunStatuses,
  evalRunSuites,
  evalStatuses,
  evalSuites,
  extensionSessionStatuses,
  feedbackEventTypes,
  fillPlanActions,
  generationModes,
  jobRemoteTypes,
  jobSources,
  matchRecommendations,
  queueTypes,
  remotePreferences,
  resumeStatuses,
  scanRunStatuses,
  scanSchedules,
  scoringStatuses,
  uncertainFieldReasons,
  usageMeteringEventTypes,
  tenantPlans,
  tenantStatuses,
  tenantTypes
} from "./domain";

const idSchema = z.string().min(1);
const isoDateSchema = z.string().datetime();
const stringListSchema = z.array(z.string().trim().min(1)).default([]);
const metadataValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const metadataSchema = z.record(metadataValueSchema);

export const tenantSchema = z.object({
  id: idSchema,
  name: z.string().trim().min(1),
  type: z.enum(tenantTypes),
  plan: z.enum(tenantPlans),
  status: z.enum(tenantStatuses),
  createdAt: isoDateSchema
});

export const userProfileSchema = z.object({
  id: idSchema,
  tenantId: idSchema,
  userId: idSchema,
  fullName: z.string().trim(),
  email: z.string().trim().email().or(z.literal("")),
  phone: z.string().trim(),
  location: z.string().trim(),
  workAuthorization: z.string().trim(),
  linkedinUrl: z.string().trim().url().or(z.literal("")),
  portfolioUrl: z.string().trim().url().or(z.literal("")),
  githubUrl: z.string().trim().url().or(z.literal("")),
  targetTitles: stringListSchema,
  targetLocations: stringListSchema,
  targetIndustries: stringListSchema,
  remotePreference: z.enum(remotePreferences),
  salaryMin: z.number().int().positive().nullable(),
  salaryTarget: z.number().int().positive().nullable(),
  companiesToAvoid: stringListSchema,
  companiesToPrioritize: stringListSchema,
  careerSummary: z.string().trim(),
  verifiedFacts: stringListSchema,
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema
});

export const resumeSchema = z.object({
  id: idSchema,
  tenantId: idSchema,
  userId: idSchema,
  originalFileName: z.string().trim().min(1),
  fileUrl: z.string().trim().min(1),
  parsedText: z.string(),
  status: z.enum(resumeStatuses),
  createdAt: isoDateSchema
});

export const normalizedJobSchema = z.object({
  id: idSchema,
  tenantId: idSchema,
  userId: idSchema,
  sourceConfigId: idSchema.nullable(),
  source: z.enum(jobSources),
  sourceJobId: z.string().trim().min(1),
  title: z.string().trim().min(1),
  company: z.string().trim().min(1),
  location: z.string().trim(),
  remoteType: z.enum(jobRemoteTypes),
  salaryMin: z.number().int().positive().nullable(),
  salaryMax: z.number().int().positive().nullable(),
  description: z.string(),
  responsibilities: stringListSchema,
  requirements: stringListSchema,
  applicationUrl: z.string().trim().url(),
  atsType: z.enum(atsTypes),
  postedAt: isoDateSchema.nullable(),
  discoveredAt: isoDateSchema,
  scoringStatus: z.enum(scoringStatuses),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema
});

export const jobSourceConfigSchema = z.object({
  id: idSchema,
  tenantId: idSchema,
  userId: idSchema,
  source: z.enum(jobSources),
  displayName: z.string().trim().min(1),
  companyName: z.string().trim(),
  boardToken: z.string().trim(),
  siteName: z.string().trim(),
  manualUrl: z.string().trim().url().or(z.literal("")),
  schedule: z.enum(scanSchedules),
  enabled: z.boolean(),
  lastScanAt: isoDateSchema.nullable(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema
});

export const scanRunSchema = z.object({
  id: idSchema,
  tenantId: idSchema,
  userId: idSchema,
  sourceConfigId: idSchema,
  source: z.enum(jobSources),
  status: z.enum(scanRunStatuses),
  startedAt: isoDateSchema,
  finishedAt: isoDateSchema.nullable(),
  jobsFetched: z.number().int().min(0),
  jobsInserted: z.number().int().min(0),
  jobsUpdated: z.number().int().min(0),
  duplicatesSkipped: z.number().int().min(0),
  errorMessage: z.string()
});

export const jobMatchSchema = z.object({
  id: idSchema,
  tenantId: idSchema,
  userId: idSchema,
  jobId: idSchema,
  overallScore: z.number().min(0).max(10),
  skillsScore: z.number().min(0).max(10),
  experienceScore: z.number().min(0).max(10),
  seniorityScore: z.number().min(0).max(10),
  locationScore: z.number().min(0).max(10),
  salaryScore: z.number().min(0).max(10),
  industryScore: z.number().min(0).max(10),
  companyFitScore: z.number().min(0).max(10),
  applicationEffortScore: z.number().min(0).max(10),
  strategicValueScore: z.number().min(0).max(10),
  recommendation: z.enum(matchRecommendations),
  queue: z.enum(queueTypes),
  topMatchReasons: stringListSchema,
  topGaps: stringListSchema,
  employerLookingFor: stringListSchema,
  summary: z.string(),
  recommendedNextAction: z.string(),
  scoringVersion: z.string().trim().min(1),
  modelName: z.string().trim().min(1),
  promptVersion: z.string().trim().min(1),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema
});

export const applicationRecordSchema = z.object({
  id: idSchema,
  tenantId: idSchema,
  userId: idSchema,
  jobId: idSchema,
  status: z.enum(applicationStatuses),
  notes: z.string(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema
});

export const applicationPackageSchema = z.object({
  id: idSchema,
  tenantId: idSchema,
  userId: idSchema,
  jobId: idSchema,
  applicationRecordId: idSchema,
  status: z.enum(applicationPackageStatuses),
  resumeMarkdown: z.string(),
  coverLetter: z.string(),
  generationMode: z.enum(generationModes),
  modelName: z.string().trim().min(1),
  promptVersion: z.string().trim().min(1),
  inputHash: z.string().trim().min(1),
  outputHash: z.string().trim().min(1),
  safetyWarnings: stringListSchema,
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
  approvedAt: isoDateSchema.nullable(),
  rejectedAt: isoDateSchema.nullable()
});

export const applicationAnswerSchema = z.object({
  id: idSchema,
  tenantId: idSchema,
  userId: idSchema,
  applicationPackageId: idSchema,
  question: z.string().trim().min(1),
  answer: z.string(),
  confidence: z.enum(answerConfidences),
  source: z.enum(applicationAnswerSources),
  needsUserReview: z.boolean(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema
});

export const detectedApplicationFieldSchema = z.object({
  id: idSchema,
  label: z.string().trim().min(1),
  fieldType: z.enum(applicationFieldTypes),
  required: z.boolean(),
  sensitive: z.boolean(),
  confidence: z.number().min(0).max(1),
  source: z.enum(applicationFieldSources),
  sourceField: z.string().trim()
});

export const filledApplicationFieldSchema = z.object({
  fieldId: idSchema,
  label: z.string().trim().min(1),
  source: z.enum(applicationFieldSources),
  sourceField: z.string().trim(),
  valuePreview: z.string().trim().min(1),
  confidence: z.number().min(0).max(1)
});

export const uncertainApplicationFieldSchema = z.object({
  fieldId: idSchema,
  label: z.string().trim().min(1),
  reason: z.enum(uncertainFieldReasons),
  required: z.boolean(),
  guidance: z.string().trim().min(1)
});

export const browserFillPlanItemSchema = z.object({
  fieldId: idSchema,
  label: z.string().trim().min(1),
  action: z.enum(fillPlanActions),
  source: z.enum(applicationFieldSources),
  sourceField: z.string().trim(),
  valuePreview: z.string().trim(),
  confidence: z.number().min(0).max(1),
  reason: z.string().trim()
});

export const browserApplicationSessionSchema = z.object({
  id: idSchema,
  tenantId: idSchema,
  userId: idSchema,
  jobId: idSchema,
  applicationRecordId: idSchema,
  applicationPackageId: idSchema,
  atsType: z.enum(browserAtsTypes),
  adapterName: z.string().trim().default("unknown"),
  adapterConfidence: z.number().min(0).max(1).default(0),
  fillMode: z.enum(browserFillModes).default("dry_run"),
  status: z.enum(browserApplicationSessionStatuses),
  fieldsDetected: z.array(detectedApplicationFieldSchema),
  fieldsFilled: z.array(filledApplicationFieldSchema),
  uncertainFields: z.array(uncertainApplicationFieldSchema),
  fillPlan: z.array(browserFillPlanItemSchema).default([]),
  screenshotUrl: z.string().trim().url().nullable(),
  errorMessage: z.string(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema
});

export const feedbackEventSchema = z.object({
  id: idSchema,
  tenantId: idSchema,
  userId: idSchema,
  eventType: z.enum(feedbackEventTypes),
  resourceType: z.string().trim().min(1),
  resourceId: idSchema,
  metadata: metadataSchema,
  createdAt: isoDateSchema
});

export const evalCaseSchema = z.object({
  id: idSchema,
  tenantId: idSchema,
  userId: idSchema,
  suite: z.enum(evalSuites),
  name: z.string().trim().min(1),
  description: z.string().trim().min(1),
  inputSummary: z.string().trim().min(1),
  expectedBehavior: z.string().trim().min(1),
  createdAt: isoDateSchema
});

export const evalRunSchema = z.object({
  id: idSchema,
  tenantId: idSchema,
  userId: idSchema,
  suite: z.enum(evalRunSuites),
  status: z.enum(evalRunStatuses),
  startedAt: isoDateSchema,
  finishedAt: isoDateSchema.nullable(),
  passCount: z.number().int().min(0),
  failCount: z.number().int().min(0)
});

export const evalResultSchema = z.object({
  id: idSchema,
  tenantId: idSchema,
  userId: idSchema,
  evalRunId: idSchema,
  evalCaseId: idSchema,
  suite: z.enum(evalSuites),
  name: z.string().trim().min(1),
  status: z.enum(evalStatuses),
  message: z.string().trim().min(1),
  severity: z.enum(["info", "warning", "critical"]),
  createdAt: isoDateSchema
});

export const usageMeteringEventSchema = z.object({
  id: idSchema,
  tenantId: idSchema,
  userId: idSchema,
  eventType: z.enum(usageMeteringEventTypes),
  resourceType: z.string().trim().min(1),
  resourceId: idSchema,
  quantity: z.number().min(0),
  unit: z.string().trim().min(1),
  metadata: metadataSchema,
  createdAt: isoDateSchema
});

export const applicationOutcomeSchema = z.object({
  id: idSchema,
  tenantId: idSchema,
  userId: idSchema,
  applicationRecordId: idSchema,
  jobId: idSchema,
  outcome: z.enum(applicationOutcomeStatuses),
  outcomeDate: isoDateSchema,
  notes: z.string(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema
});

export const aiOutputMetadataSchema = z.object({
  id: idSchema,
  tenantId: idSchema,
  userId: idSchema,
  outputType: z.enum(aiOutputTypes),
  resourceType: z.string().trim().min(1),
  resourceId: idSchema,
  modelName: z.string().trim().min(1),
  promptVersion: z.string().trim().min(1),
  provider: z.string().trim().min(1),
  mode: z.string().trim().min(1),
  inputHash: z.string().trim().min(1),
  outputHash: z.string().trim().min(1),
  tokenInput: z.number().int().min(0),
  tokenOutput: z.number().int().min(0),
  createdAt: isoDateSchema
});

export const auditLogSchema = z.object({
  id: idSchema,
  tenantId: idSchema,
  actorUserId: idSchema,
  action: z.string().trim().min(1),
  resourceType: z.string().trim().min(1),
  resourceId: idSchema,
  metadata: metadataSchema,
  createdAt: isoDateSchema
});

export const extensionPageStructureFieldSchema = z.object({
  fieldId: z.string().trim().min(1),
  label: z.string().trim().min(1),
  fieldType: z.enum(applicationFieldTypes),
  inputName: z.string().trim().default(""),
  inputId: z.string().trim().default(""),
  placeholder: z.string().trim().default(""),
  required: z.boolean(),
  sensitive: z.boolean(),
  hasValue: z.boolean()
});

export const extensionPageStructureSchema = z.object({
  pageUrl: z.string().trim().url(),
  pageTitle: z.string().trim(),
  hostname: z.string().trim().min(1),
  fields: z.array(extensionPageStructureFieldSchema),
  hasSubmitButton: z.boolean(),
  hasCaptcha: z.boolean(),
  hasLoginChallenge: z.boolean(),
  capturedAt: isoDateSchema
});

export const extractedResumeProfileSchema = z.object({
  fullName: z.string().trim().default(""),
  email: z.string().trim().default(""),
  phone: z.string().trim().default(""),
  location: z.string().trim().default(""),
  linkedinUrl: z.string().trim().default(""),
  githubUrl: z.string().trim().default(""),
  portfolioUrl: z.string().trim().default(""),
  currentTitle: z.string().trim().default(""),
  seniorityLevel: z.string().trim().default(""),
  yearsOfExperience: z.number().nullable(),
  industries: stringListSchema,
  companies: stringListSchema,
  jobTitles: stringListSchema,
  education: stringListSchema,
  certifications: stringListSchema,
  skills: stringListSchema,
  tools: stringListSchema,
  projects: stringListSchema,
  leadershipExamples: stringListSchema,
  quantifiedAchievements: stringListSchema,
  workAuthorization: z.string().trim().default(""),
  resumeStrengths: stringListSchema,
  resumeGaps: stringListSchema
});

export const resumeFieldConfidenceMapSchema = z.object({
  fullName: z.enum(resumeFieldConfidences),
  email: z.enum(resumeFieldConfidences),
  phone: z.enum(resumeFieldConfidences),
  location: z.enum(resumeFieldConfidences),
  linkedinUrl: z.enum(resumeFieldConfidences),
  githubUrl: z.enum(resumeFieldConfidences),
  portfolioUrl: z.enum(resumeFieldConfidences),
  currentTitle: z.enum(resumeFieldConfidences),
  seniorityLevel: z.enum(resumeFieldConfidences),
  yearsOfExperience: z.enum(resumeFieldConfidences),
  skills: z.enum(resumeFieldConfidences),
  industries: z.enum(resumeFieldConfidences)
});

export const resumeIntelligenceSuggestedFixSchema = z.object({
  field: z.string().trim().min(1),
  severity: z.enum(atsRiskLevels),
  message: z.string().trim().min(1),
  recommendedAction: z.string().trim().default("")
});

export const resumeIntelligenceReportSchema = z.object({
  id: idSchema,
  tenantId: idSchema,
  userId: idSchema,
  resumeId: idSchema,
  extractionMode: z.enum(resumeIntelligenceModes),
  modelName: z.string().trim().min(1),
  promptVersion: z.string().trim().min(1),
  extractedProfile: extractedResumeProfileSchema,
  confidenceByField: resumeFieldConfidenceMapSchema,
  missingFields: stringListSchema,
  ambiguousFields: stringListSchema,
  parsingWarnings: stringListSchema,
  atsRiskScore: z.number().min(0).max(100),
  atsRiskLevel: z.enum(atsRiskLevels),
  suggestedFixes: z.array(resumeIntelligenceSuggestedFixSchema).default([]),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema
});

export const recommendedRoleSchema = z.object({
  title: z.string().trim().min(1),
  fitLevel: z.enum(recommendedRoleFitLevels),
  confidence: z.enum(resumeFieldConfidences),
  why: z.string().trim().default(""),
  evidenceFromResume: stringListSchema,
  searchKeywords: stringListSchema,
  suggestedResumeAngle: z.string().trim().default("")
});

export const skillGapSchema = z.object({
  skill: z.string().trim().min(1),
  importance: z.enum(skillGapImportances),
  reason: z.string().trim().default(""),
  howToClose: z.string().trim().default("")
});

export const jobTargetRecommendationSchema = z.object({
  id: idSchema,
  tenantId: idSchema,
  userId: idSchema,
  resumeId: idSchema,
  reportId: idSchema,
  strongestRoles: z.array(recommendedRoleSchema).default([]),
  adjacentRoles: z.array(recommendedRoleSchema).default([]),
  stretchRoles: z.array(recommendedRoleSchema).default([]),
  rolesToAvoid: z.array(recommendedRoleSchema).default([]),
  recommendedIndustries: stringListSchema,
  recommendedSeniority: z.string().trim().default(""),
  recommendedSearchKeywords: stringListSchema,
  positioningSummary: z.string().trim().default(""),
  resumePositioningAdvice: stringListSchema,
  skillGaps: z.array(skillGapSchema).default([]),
  confidence: z.enum(resumeFieldConfidences),
  extractionMode: z.enum(resumeIntelligenceModes),
  modelName: z.string().trim().min(1),
  promptVersion: z.string().trim().min(1),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema
});

export const recruiterContactSchema = z.object({
  id: idSchema,
  tenantId: idSchema,
  userId: idSchema,
  jobId: idSchema,
  applicationRecordId: idSchema.nullable(),
  company: z.string().trim().min(1),
  name: z.string().trim().default(""),
  title: z.string().trim().default(""),
  email: z.string().trim().default(""),
  publicProfileUrl: z.string().trim().default(""),
  source: z.enum(recruiterContactSources),
  confidence: z.enum(recruiterContactConfidences),
  notes: z.string().default(""),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema
});

export const outreachDraftSchema = z.object({
  id: idSchema,
  tenantId: idSchema,
  userId: idSchema,
  jobId: idSchema,
  applicationRecordId: idSchema.nullable(),
  recruiterContactId: idSchema.nullable(),
  type: z.enum(outreachDraftTypes),
  subject: z.string().trim().default(""),
  body: z.string().trim().default(""),
  status: z.enum(outreachDraftStatuses),
  generationMode: z.enum(resumeIntelligenceModes),
  modelName: z.string().trim().min(1),
  promptVersion: z.string().trim().min(1),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
  approvedAt: isoDateSchema.nullable(),
  sentManuallyAt: isoDateSchema.nullable()
});

export const followUpReminderSchema = z.object({
  id: idSchema,
  tenantId: idSchema,
  userId: idSchema,
  jobId: idSchema,
  applicationRecordId: idSchema.nullable(),
  recruiterContactId: idSchema.nullable(),
  dueAt: isoDateSchema,
  reason: z.string().trim().min(1),
  status: z.enum(followUpReminderStatuses),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema
});

export const interviewNoteSchema = z.object({
  id: idSchema,
  tenantId: idSchema,
  userId: idSchema,
  jobId: idSchema,
  applicationRecordId: idSchema.nullable(),
  stage: z.enum(interviewStages),
  scheduledAt: isoDateSchema.nullable(),
  interviewerNames: stringListSchema,
  notes: z.string().default(""),
  questionsAsked: stringListSchema,
  followUps: stringListSchema,
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema
});

export const resumeImprovementDraftSchema = z.object({
  id: idSchema,
  tenantId: idSchema,
  userId: idSchema,
  sourceResumeId: idSchema,
  improvedResumeId: idSchema.nullable(),
  reportId: idSchema,
  status: z.enum(resumeImprovementStatuses),
  generationMode: z.enum(resumeIntelligenceModes),
  modelName: z.string().trim().min(1),
  promptVersion: z.string().trim().min(1),
  originalRiskLevel: z.enum(atsRiskLevels),
  improvedRiskLevel: z.enum(atsRiskLevels).nullable(),
  originalRiskScore: z.number().min(0).max(100),
  improvedRiskScore: z.number().min(0).max(100).nullable(),
  draftMarkdown: z.string(),
  changesSummary: stringListSchema,
  appliedFixes: stringListSchema,
  warningsRemaining: stringListSchema,
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
  savedAt: isoDateSchema.nullable(),
  rejectedAt: isoDateSchema.nullable()
});

export const onboardingStateSchema = z.object({
  id: idSchema,
  tenantId: idSchema,
  userId: idSchema,
  selectedTargetRoles: stringListSchema,
  onboardingJobsGenerated: z.boolean().default(false),
  onboardingJobsScored: z.boolean().default(false),
  firstApplyReadyJobsShown: z.boolean().default(false),
  firstJobReviewed: z.boolean().default(false),
  onboardingCompletedAt: isoDateSchema.nullable(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema
});

export const companyIntelligenceSchema = z.object({
  id: idSchema,
  tenantId: idSchema,
  userId: idSchema,
  jobId: idSchema,
  company: z.string().trim().min(1),
  summary: z.string().trim(),
  businessModel: z.string().trim().default(""),
  industry: z.string().trim().default(""),
  companySize: z.string().trim().default(""),
  fundingStage: z.string().trim().default(""),
  recentSignals: stringListSchema,
  whyThisCompany: z.string().trim().default(""),
  interviewPrepNotes: stringListSchema,
  compensationSignals: z.string().trim().default(""),
  referralStrategy: z.string().trim().default(""),
  source: z.enum(intelligenceSources),
  confidence: z.enum(intelligenceConfidences),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema
});

export const recruiterLeadSchema = z.object({
  id: idSchema,
  tenantId: idSchema,
  userId: idSchema,
  jobId: idSchema,
  company: z.string().trim().min(1),
  name: z.string().trim(),
  title: z.string().trim().default(""),
  publicProfileUrl: z.string().trim().default(""),
  source: z.enum(intelligenceSources),
  confidence: z.enum(intelligenceConfidences),
  outreachSuggestion: z.string().trim().default(""),
  createdAt: isoDateSchema
});

export const jobRiskSignalSchema = z.object({
  id: idSchema,
  tenantId: idSchema,
  userId: idSchema,
  jobId: idSchema,
  riskType: z.enum(jobRiskSignalTypes),
  severity: z.enum(jobRiskSeverities),
  explanation: z.string().trim().min(1),
  recommendedAction: z.string().trim().default(""),
  createdAt: isoDateSchema
});

export const careerOpsSettingsSchema = z.object({
  id: idSchema,
  tenantId: idSchema,
  userId: idSchema,
  scheduleMode: z.enum(careerOpsScheduleModes),
  preparePackagesForHighScoreJobs: z.boolean(),
  highScoreThreshold: z.number().min(0).max(10),
  overrideHighRiskPackagePrep: z.boolean().default(false),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema
});

export const careerOpsDigestSummarySchema = z.object({
  jobsFound: z.number().int().min(0),
  highMatches: z.number().int().min(0),
  mediumMatches: z.number().int().min(0),
  lowMatches: z.number().int().min(0),
  packagesPrepared: z.number().int().min(0),
  recommendedNextAction: z.string().trim(),
  warnings: stringListSchema,
  lines: stringListSchema
});

export const careerOpsRunSchema = z.object({
  id: idSchema,
  tenantId: idSchema,
  userId: idSchema,
  mode: z.enum(careerOpsRunModes),
  status: z.enum(careerOpsRunStatuses),
  startedAt: isoDateSchema,
  completedAt: isoDateSchema.nullable(),
  ingestionRunIds: z.array(z.string()).default([]),
  jobsFound: z.number().int().min(0),
  jobsInserted: z.number().int().min(0),
  jobsUpdated: z.number().int().min(0),
  duplicatesFound: z.number().int().min(0),
  jobsScored: z.number().int().min(0),
  applyReviewCount: z.number().int().min(0),
  maybeCount: z.number().int().min(0),
  browseCount: z.number().int().min(0),
  packagesPrepared: z.number().int().min(0),
  digestSummary: careerOpsDigestSummarySchema,
  errorMessage: z.string().default(""),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema
});

export const realSiteValidationSummarySchema = z.object({
  adapterDetectedCorrectly: z.boolean(),
  requiredFieldsFound: z.boolean(),
  safeFieldsMapped: z.boolean(),
  uncertainFieldsPaused: z.boolean(),
  sensitiveFieldsPaused: z.boolean(),
  submitBlocked: z.boolean()
});

export const realSiteDryRunSnapshotSchema = z.object({
  id: idSchema,
  tenantId: idSchema,
  userId: idSchema,
  sourceUrl: z.string().trim(),
  redactedUrl: z.string().trim(),
  hostname: z.string().trim(),
  atsType: z.enum(browserAtsTypes),
  adapterConfidence: z.number().min(0).max(1),
  pageTitle: z.string().trim().default(""),
  detectedFieldCount: z.number().int().min(0),
  requiredFieldCount: z.number().int().min(0),
  safeFillCount: z.number().int().min(0),
  pausedFieldCount: z.number().int().min(0),
  sensitiveFieldCount: z.number().int().min(0),
  submitButtonCount: z.number().int().min(0),
  submitBlocked: z.boolean(),
  submitBlockedReason: z.string().trim(),
  validationSummary: realSiteValidationSummarySchema,
  source: z.enum(["extension_session", "url_only"]),
  extensionSessionId: idSchema.nullable(),
  createdAt: isoDateSchema
});

export const extensionSessionSchema = z.object({
  id: idSchema,
  tenantId: idSchema,
  userId: idSchema,
  extensionInstanceId: z.string().trim().min(1),
  pageUrl: z.string().trim(),
  pageTitle: z.string().trim().default(""),
  hostname: z.string().trim().default(""),
  status: z.enum(extensionSessionStatuses),
  applicationPackageId: idSchema.nullable(),
  applicationRecordId: idSchema.nullable(),
  jobId: idSchema.nullable(),
  browserApplicationSessionId: idSchema.nullable(),
  fieldsDetected: z.array(detectedApplicationFieldSchema).default([]),
  fieldsFilled: z.array(filledApplicationFieldSchema).default([]),
  uncertainFields: z.array(uncertainApplicationFieldSchema).default([]),
  fillPlan: z.array(browserFillPlanItemSchema).default([]),
  pageStructureHash: z.string().trim().default(""),
  authorizedAt: isoDateSchema.nullable(),
  fillApprovedAt: isoDateSchema.nullable(),
  submitApprovedAt: isoDateSchema.nullable(),
  submittedAt: isoDateSchema.nullable(),
  disconnectedAt: isoDateSchema.nullable(),
  errorMessage: z.string().default(""),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema
});
