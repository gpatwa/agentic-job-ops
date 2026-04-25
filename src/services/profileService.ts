import type { AppSession, UserProfile } from "../models/domain";
import { userProfileSchema } from "../models/schemas";
import { readJson, scopedKey, writeJson } from "../lib/storage";

export interface UserProfileDraft {
  fullName: string;
  email: string;
  phone: string;
  location: string;
  workAuthorization: string;
  linkedinUrl: string;
  portfolioUrl: string;
  githubUrl: string;
  targetTitles: string;
  targetLocations: string;
  targetIndustries: string;
  remotePreference: UserProfile["remotePreference"];
  salaryMin: string;
  salaryTarget: string;
  companiesToAvoid: string;
  companiesToPrioritize: string;
  careerSummary: string;
  verifiedFacts: string;
}

function createId(prefix: string): string {
  return `${prefix}_${globalThis.crypto.randomUUID()}`;
}

function profileKey(session: AppSession): string {
  return scopedKey(session.tenant.id, session.userId, "profile");
}

function splitList(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatList(value: string[]): string {
  return value.join(", ");
}

function parseCurrency(value: string): number | null {
  const normalized = value.replace(/[$,\s]/g, "");
  if (!normalized) {
    return null;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : null;
}

export function createEmptyProfile(session: AppSession): UserProfile {
  const now = new Date().toISOString();

  return {
    id: createId("profile"),
    tenantId: session.tenant.id,
    userId: session.userId,
    fullName: "",
    email: "",
    phone: "",
    location: "",
    workAuthorization: "",
    linkedinUrl: "",
    portfolioUrl: "",
    githubUrl: "",
    targetTitles: [],
    targetLocations: [],
    targetIndustries: [],
    remotePreference: "any",
    salaryMin: null,
    salaryTarget: null,
    companiesToAvoid: [],
    companiesToPrioritize: [],
    careerSummary: "",
    verifiedFacts: [],
    createdAt: now,
    updatedAt: now
  };
}

export function profileToDraft(profile: UserProfile): UserProfileDraft {
  return {
    fullName: profile.fullName,
    email: profile.email,
    phone: profile.phone,
    location: profile.location,
    workAuthorization: profile.workAuthorization,
    linkedinUrl: profile.linkedinUrl,
    portfolioUrl: profile.portfolioUrl,
    githubUrl: profile.githubUrl,
    targetTitles: formatList(profile.targetTitles),
    targetLocations: formatList(profile.targetLocations),
    targetIndustries: formatList(profile.targetIndustries),
    remotePreference: profile.remotePreference,
    salaryMin: profile.salaryMin ? String(profile.salaryMin) : "",
    salaryTarget: profile.salaryTarget ? String(profile.salaryTarget) : "",
    companiesToAvoid: formatList(profile.companiesToAvoid),
    companiesToPrioritize: formatList(profile.companiesToPrioritize),
    careerSummary: profile.careerSummary,
    verifiedFacts: formatList(profile.verifiedFacts)
  };
}

export function draftToProfile(
  session: AppSession,
  draft: UserProfileDraft,
  existingProfile: UserProfile | null
): UserProfile {
  const now = new Date().toISOString();
  const profile: UserProfile = {
    id: existingProfile?.id ?? createId("profile"),
    tenantId: session.tenant.id,
    userId: session.userId,
    fullName: draft.fullName.trim(),
    email: draft.email.trim(),
    phone: draft.phone.trim(),
    location: draft.location.trim(),
    workAuthorization: draft.workAuthorization.trim(),
    linkedinUrl: draft.linkedinUrl.trim(),
    portfolioUrl: draft.portfolioUrl.trim(),
    githubUrl: draft.githubUrl.trim(),
    targetTitles: splitList(draft.targetTitles),
    targetLocations: splitList(draft.targetLocations),
    targetIndustries: splitList(draft.targetIndustries),
    remotePreference: draft.remotePreference,
    salaryMin: parseCurrency(draft.salaryMin),
    salaryTarget: parseCurrency(draft.salaryTarget),
    companiesToAvoid: splitList(draft.companiesToAvoid),
    companiesToPrioritize: splitList(draft.companiesToPrioritize),
    careerSummary: draft.careerSummary.trim(),
    verifiedFacts: splitList(draft.verifiedFacts),
    createdAt: existingProfile?.createdAt ?? now,
    updatedAt: now
  };

  return userProfileSchema.parse(profile);
}

export function loadUserProfile(session: AppSession): UserProfile | null {
  const profile = readJson<UserProfile | null>(profileKey(session), null);
  if (!profile) {
    return null;
  }

  const parsed = userProfileSchema.safeParse(profile);
  return parsed.success ? parsed.data : null;
}

export function saveUserProfile(
  session: AppSession,
  draft: UserProfileDraft,
  existingProfile: UserProfile | null
): UserProfile {
  const profile = draftToProfile(session, draft, existingProfile);
  writeJson(profileKey(session), profile);
  return profile;
}
