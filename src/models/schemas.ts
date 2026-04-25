import { z } from "zod";
import {
  applicationStatuses,
  jobSources,
  queueTypes,
  remotePreferences,
  resumeStatuses,
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
  source: z.enum(jobSources),
  externalId: z.string().trim().min(1),
  title: z.string().trim().min(1),
  companyName: z.string().trim().min(1),
  location: z.string().trim(),
  remotePreference: z.enum(remotePreferences),
  descriptionText: z.string(),
  applyUrl: z.string().trim().url(),
  discoveredAt: isoDateSchema,
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema
});

export const jobMatchSchema = z.object({
  id: idSchema,
  tenantId: idSchema,
  userId: idSchema,
  jobId: idSchema,
  score: z.number().min(0).max(10),
  queue: z.enum(queueTypes),
  rationale: z.string(),
  modelVersion: z.string().trim().min(1),
  createdAt: isoDateSchema
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
