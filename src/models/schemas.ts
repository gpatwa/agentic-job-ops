import { z } from "zod";
import {
  applicationStatuses,
  atsTypes,
  jobRemoteTypes,
  jobSources,
  matchRecommendations,
  queueTypes,
  remotePreferences,
  resumeStatuses,
  scanRunStatuses,
  scanSchedules,
  scoringStatuses,
  tenantPlans,
  tenantStatuses,
  tenantTypes
} from "./domain";

const idSchema = z.string().min(1);
const isoDateSchema = z.string().datetime();
const stringListSchema = z.array(z.string().trim().min(1)).default([]);

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

export const auditLogSchema = z.object({
  id: idSchema,
  tenantId: idSchema,
  actorUserId: idSchema,
  action: z.string().trim().min(1),
  resourceType: z.string().trim().min(1),
  resourceId: idSchema,
  metadata: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])),
  createdAt: isoDateSchema
});
