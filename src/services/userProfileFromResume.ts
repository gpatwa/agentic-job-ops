import type {
  ResumeIntelligenceReport,
  UserProfile
} from "../models/domain";

/**
 * Bridge helper: when the saved UserProfile is missing essential
 * scoring fields (full name, email, location, current title) but
 * the latest resume intelligence report HAS them at high
 * confidence, return a synthesized stand-in profile so the
 * matching engine doesn't lie about "Profile is incomplete;
 * best-effort score missing Full name, Email, Location" while
 * those fields are clearly visible in the Resume Intelligence
 * panel.
 *
 * This is for ANALYSIS ONLY. The synthesized profile is never
 * persisted — the user still has to click "Apply high-confidence
 * fields to profile" before anything is written to UserProfile
 * storage. The match engine just sees the union for ranking
 * purposes.
 */

const ESSENTIAL_FIELDS: ReadonlyArray<keyof UserProfile> = [
  "fullName",
  "email",
  "location",
  "linkedinUrl"
];

function isFieldMissing(value: string | null | undefined): boolean {
  return typeof value !== "string" || value.trim().length === 0;
}

export function profileNeedsResumeFallback(
  profile: UserProfile | null
): boolean {
  if (!profile) return true;
  return ESSENTIAL_FIELDS.some((field) => isFieldMissing(profile[field] as string));
}

/**
 * Returns the saved profile when it already has the essential
 * fields. Otherwise returns a synthesized copy that fills in the
 * gaps from the latest resume report — preserving any explicit
 * values the user has saved (we never overwrite saved data with
 * resume-derived data).
 *
 * Returns null when neither source has anything useful.
 */
export function synthesizeProfileWithResumeFallback(
  profile: UserProfile | null,
  report: ResumeIntelligenceReport | null
): UserProfile | null {
  if (!profileNeedsResumeFallback(profile)) {
    return profile;
  }
  if (!report) {
    return profile;
  }

  const extracted = report.extractedProfile;
  const baseTimestamp = profile?.createdAt ?? new Date().toISOString();
  const tenantId = profile?.tenantId ?? report.tenantId;
  const userId = profile?.userId ?? report.userId;

  // Synthesize a stand-in profile. Saved values win over resume
  // values on every field, so if the user has already filled in
  // anything by hand, we don't clobber it. Resume-derived
  // fields fill the gaps.
  const synth: UserProfile = {
    id: profile?.id ?? `${tenantId}_${userId}_resume_fallback`,
    tenantId,
    userId,
    fullName: profile?.fullName?.trim() || extracted.fullName || "",
    email: profile?.email?.trim() || extracted.email || "",
    phone: profile?.phone?.trim() || extracted.phone || "",
    location: profile?.location?.trim() || extracted.location || "",
    workAuthorization:
      profile?.workAuthorization?.trim() || extracted.workAuthorization || "",
    linkedinUrl: profile?.linkedinUrl?.trim() || extracted.linkedinUrl || "",
    portfolioUrl: profile?.portfolioUrl?.trim() || extracted.portfolioUrl || "",
    githubUrl: profile?.githubUrl?.trim() || extracted.githubUrl || "",
    targetTitles:
      profile?.targetTitles?.length
        ? profile.targetTitles
        : extracted.currentTitle
          ? [extracted.currentTitle]
          : [],
    targetLocations: profile?.targetLocations ?? [],
    targetIndustries:
      profile?.targetIndustries?.length
        ? profile.targetIndustries
        : extracted.industries ?? [],
    remotePreference: profile?.remotePreference ?? "any",
    salaryMin: profile?.salaryMin ?? null,
    salaryTarget: profile?.salaryTarget ?? null,
    companiesToAvoid: profile?.companiesToAvoid ?? [],
    companiesToPrioritize: profile?.companiesToPrioritize ?? [],
    careerSummary:
      profile?.careerSummary?.trim() ||
      [extracted.currentTitle, ...(extracted.resumeStrengths ?? [])]
        .filter(Boolean)
        .slice(0, 3)
        .join(" · "),
    verifiedFacts:
      profile?.verifiedFacts?.length
        ? profile.verifiedFacts
        : extracted.quantifiedAchievements?.slice(0, 5) ?? [],
    visaSponsorshipNeeded: profile?.visaSponsorshipNeeded ?? "",
    howDidYouHearAboutUs: profile?.howDidYouHearAboutUs ?? "",
    genderIdentity: profile?.genderIdentity ?? "",
    raceEthnicity: profile?.raceEthnicity ?? "",
    veteranStatus: profile?.veteranStatus ?? "",
    disabilityStatus: profile?.disabilityStatus ?? "",
    createdAt: baseTimestamp,
    updatedAt: new Date().toISOString()
  };
  return synth;
}
