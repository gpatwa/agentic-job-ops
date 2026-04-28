import type {
  AppSession,
  JobMatch,
  MatchRecommendation,
  NormalizedJob,
  QueueType,
  UserProfile
} from "../models/domain";
import { jobMatchSchema, normalizedJobSchema } from "../models/schemas";
import { calculateProfileCompletion } from "../lib/profileCompletion";
import { readJson, scopedKey, writeJson } from "../lib/storage";
import { loadNormalizedJobs, saveNormalizedJobs } from "./jobIngestion";

const SCORING_VERSION = "phase3-deterministic-v1";
const PROMPT_VERSION = "phase3-match-score-v1";
const DETERMINISTIC_MODEL_NAME = "deterministic-fallback";
const LLM_PLACEHOLDER_MODEL_NAME = "llm-placeholder";

const stopWords = new Set([
  "and",
  "are",
  "but",
  "for",
  "from",
  "has",
  "have",
  "into",
  "our",
  "the",
  "their",
  "this",
  "that",
  "with",
  "you",
  "your",
  "will"
]);

export interface MatchEngineInput {
  profile: UserProfile | null;
  jobs: NormalizedJob[];
  existingMatches?: JobMatch[];
}

export interface MatchScoringInput {
  session: AppSession;
  profile: UserProfile | null;
  job: NormalizedJob;
  existingMatch: JobMatch | null;
}

export interface MatchScoringAdapter {
  modelName: string;
  scoreJob(input: MatchScoringInput): Promise<JobMatch>;
}

export interface MatchScoringResult {
  matches: JobMatch[];
  jobs: NormalizedJob[];
  scoredCount: number;
  applyCount: number;
  maybeCount: number;
  browseCount: number;
  skipCount: number;
  profileWarning: string;
}

export interface MatchEngine {
  scoreJobs(input: MatchEngineInput): Promise<JobMatch[]>;
}

function createId(prefix: string): string {
  return `${prefix}_${globalThis.crypto.randomUUID()}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function matchesKey(session: AppSession): string {
  return scopedKey(session.tenant.id, session.userId, "job_matches");
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(10, Math.round(value * 10) / 10));
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9+#.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(value: string): string[] {
  return normalizeText(value)
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length > 2 && !stopWords.has(token));
}

function uniqueTokens(values: string[]): string[] {
  return Array.from(new Set(values.flatMap(tokenize)));
}

function includesPhrase(value: string, phrase: string): boolean {
  return normalizeText(value).includes(normalizeText(phrase));
}

function overlapScore(profileTokens: string[], jobTokens: string[]): number {
  if (profileTokens.length === 0) {
    return 4.5;
  }

  const jobSet = new Set(jobTokens);
  const overlap = profileTokens.filter((token) => jobSet.has(token)).length;
  const ratio = overlap / Math.max(profileTokens.length, 1);
  return clampScore(3.5 + ratio * 10);
}

function listContainsCompany(list: string[], company: string): boolean {
  return list.some((item) => includesPhrase(company, item) || includesPhrase(item, company));
}

function titleOverlapScore(profile: UserProfile | null, job: NormalizedJob): number {
  if (!profile || profile.targetTitles.length === 0) {
    return 5;
  }

  const jobTitle = normalizeText(job.title);
  const best = profile.targetTitles.reduce((score, title) => {
    const targetTokens = tokenize(title);
    if (targetTokens.length === 0) {
      return score;
    }

    const overlap = targetTokens.filter((token) => jobTitle.includes(token)).length;
    return Math.max(score, overlap / targetTokens.length);
  }, 0);

  return clampScore(3 + best * 7);
}

function seniorityLevel(value: string): number {
  const normalized = normalizeText(value);
  if (normalized.includes("principal") || normalized.includes("staff")) {
    return 5;
  }

  if (normalized.includes("senior") || normalized.includes("lead")) {
    return 4;
  }

  if (normalized.includes("manager") || normalized.includes("head")) {
    return 4;
  }

  if (normalized.includes("junior") || normalized.includes("associate")) {
    return 2;
  }

  if (normalized.includes("intern")) {
    return 1;
  }

  return 3;
}

function seniorityScore(profile: UserProfile | null, job: NormalizedJob): number {
  if (!profile || profile.targetTitles.length === 0) {
    return 5.5;
  }

  const jobLevel = seniorityLevel(job.title);
  const targetLevels = profile.targetTitles.map(seniorityLevel);
  const closestDifference = Math.min(
    ...targetLevels.map((targetLevel) => Math.abs(targetLevel - jobLevel))
  );

  return clampScore(10 - closestDifference * 2.2);
}

function locationScore(profile: UserProfile | null, job: NormalizedJob): number {
  if (!profile) {
    return 5;
  }

  if (profile.remotePreference === "any") {
    return job.remoteType === "unknown" ? 6.5 : 8;
  }

  if (profile.remotePreference === "remote") {
    if (job.remoteType === "remote") {
      return 10;
    }

    if (job.remoteType === "hybrid") {
      return 6.5;
    }

    return 3.5;
  }

  if (profile.remotePreference === "hybrid") {
    if (job.remoteType === "hybrid") {
      return 10;
    }

    if (job.remoteType === "remote") {
      return 7;
    }
  }

  if (profile.remotePreference === "onsite" && job.remoteType === "onsite") {
    return 8;
  }

  const locationText = `${job.location} ${job.remoteType}`;
  const targetLocationMatch = profile.targetLocations.some((location) =>
    includesPhrase(locationText, location)
  );

  return targetLocationMatch ? 8.5 : 5;
}

function salaryScore(profile: UserProfile | null, job: NormalizedJob): number {
  if (!profile || (!profile.salaryMin && !profile.salaryTarget)) {
    return 6;
  }

  if (!job.salaryMin && !job.salaryMax) {
    return 5.5;
  }

  const target = profile.salaryTarget ?? profile.salaryMin ?? 0;
  const minimum = profile.salaryMin ?? target;
  const jobMax = job.salaryMax ?? job.salaryMin ?? 0;
  const jobMin = job.salaryMin ?? jobMax;

  if (jobMax < minimum) {
    return 2.5;
  }

  if (jobMin >= target) {
    return 9.5;
  }

  if (jobMax >= target) {
    return 8;
  }

  return 6.5;
}

function applicationEffortScore(job: NormalizedJob): number {
  if (job.source === "manual") {
    return 4;
  }

  if (job.requirements.length + job.responsibilities.length > 8) {
    return 8;
  }

  if (job.description.length > 300) {
    return 7.2;
  }

  return 5.2;
}

function recommendationFromScore(
  score: number,
  companyAvoided: boolean
): MatchRecommendation {
  if (companyAvoided || score < 3) {
    return "skip";
  }

  if (score >= 8) {
    return "apply";
  }

  if (score >= 5.5) {
    return "maybe";
  }

  return "browse";
}

export function queueFromRecommendation(
  recommendation: MatchRecommendation
): QueueType {
  if (recommendation === "apply") {
    return "apply_review";
  }

  if (recommendation === "maybe") {
    return "maybe";
  }

  return "browse";
}

function summaryForJob(job: NormalizedJob): string {
  const description = job.description.trim();
  if (!description || description.length < 80) {
    return `${job.title} at ${job.company} in ${job.location || "an unspecified location"}. The posting has limited detail, so the score is conservative.`;
  }

  const firstSentence = description
    .split(/[.!?]\s/)
    .map((sentence) => sentence.trim())
    .find((sentence) => sentence.length > 40);

  const cleanSentence = firstSentence?.replace(/[.!?]+$/, "");

  return cleanSentence
    ? `${job.title} at ${job.company}: ${cleanSentence}.`
    : `${job.title} at ${job.company} appears focused on ${description.slice(0, 150)}.`;
}

function employerLookingFor(job: NormalizedJob): string[] {
  const explicit = [...job.requirements, ...job.responsibilities]
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 5);

  if (explicit.length > 0) {
    return explicit;
  }

  const descriptionTokens = uniqueTokens([job.description])
    .filter((token) => token.length > 4)
    .slice(0, 5);

  return descriptionTokens.length > 0
    ? descriptionTokens.map((token) => `Evidence of ${token}`)
    : ["More job detail needed before preparing an application package"];
}

function recommendedAction(
  recommendation: MatchRecommendation,
  incompleteProfile: boolean
): string {
  const prefix = incompleteProfile
    ? "Complete missing profile fields, then "
    : "";

  if (recommendation === "apply") {
    return `${prefix}move this job to Apply Review for human decision.`;
  }

  if (recommendation === "maybe") {
    return `${prefix}review the gaps before preparing any tailored material.`;
  }

  // "skip" = strong mismatch (score < 3 or company on the avoid
  // list). "browse" = below the maybe threshold but not actively
  // bad. Both are honestly "skip" from the candidate's POV — the
  // older "keep this in Browse" copy was confusing because it
  // implied the candidate should still spend attention on it.
  if (recommendation === "skip") {
    return "Skip — strong mismatch (or the company is on your avoid list).";
  }

  return "Skip — not aligned with your target roles.";
}

function buildReasons(input: {
  profile: UserProfile | null;
  job: NormalizedJob;
  skillsScore: number;
  seniorityScoreValue: number;
  locationScoreValue: number;
  salaryScoreValue: number;
  industryScore: number;
  companyFitScore: number;
  strategicValueScore: number;
}): string[] {
  const reasons: string[] = [];
  const { profile, job } = input;

  if (titleOverlapScore(profile, job) >= 7.5) {
    reasons.push("Title aligns with a target role.");
  }

  if (input.skillsScore >= 7) {
    reasons.push("Posting language overlaps with the profile and verified facts.");
  }

  if (input.seniorityScoreValue >= 7) {
    reasons.push("Seniority level appears aligned.");
  }

  if (input.locationScoreValue >= 8) {
    reasons.push("Location or remote setup fits the stated preference.");
  }

  if (input.salaryScoreValue >= 8) {
    reasons.push("Salary range appears compatible with the profile target.");
  }

  if (input.industryScore >= 7) {
    reasons.push("Industry signals match the stated target industries.");
  }

  if (input.companyFitScore >= 9) {
    reasons.push("Company is on the prioritize list.");
  }

  if (input.strategicValueScore >= 7.5) {
    reasons.push("Role has strong strategic value for the stated search.");
  }

  // Return an empty array when no positive signals exist instead
  // of a fallback bullet. The old "Limited positive fit signals…"
  // string was rendered inside a panel labeled "Top match reasons",
  // which read as a contradiction. Renderers gate on length > 0
  // and hide the panel when there's nothing positive to show.
  return reasons.slice(0, 5);
}

function buildGaps(input: {
  profile: UserProfile | null;
  job: NormalizedJob;
  profileWarning: string;
  companyAvoided: boolean;
  skillsScore: number;
  locationScoreValue: number;
  salaryScoreValue: number;
  industryScore: number;
  weakDescription: boolean;
}): string[] {
  const gaps: string[] = [];
  const { job } = input;

  if (input.profileWarning) {
    gaps.push(input.profileWarning);
  }

  if (input.companyAvoided) {
    gaps.push("Company is listed in companies to avoid.");
  }

  if (input.weakDescription) {
    gaps.push("Job description is missing or too thin for a confident score.");
  }

  if (input.skillsScore < 5.5) {
    gaps.push("Limited skills overlap with the current profile.");
  }

  if (input.locationScoreValue < 5.5) {
    gaps.push(`Location or remote setup may not fit: ${job.location || job.remoteType}.`);
  }

  if (input.salaryScoreValue < 5.5) {
    gaps.push("Salary range is missing or may be below target.");
  }

  if (input.industryScore < 5.5) {
    gaps.push("Industry alignment is unclear from the posting.");
  }

  return gaps.length > 0 ? gaps.slice(0, 5) : ["No major gaps detected yet."];
}

function scoreIndustry(profile: UserProfile | null, jobText: string): number {
  if (!profile || profile.targetIndustries.length === 0) {
    return 5;
  }

  const matches = profile.targetIndustries.filter((industry) =>
    includesPhrase(jobText, industry)
  ).length;

  return matches > 0 ? clampScore(6.5 + matches * 1.5) : 4.5;
}

function scoreStrategicValue(input: {
  titleScore: number;
  industryScore: number;
  companyFitScore: number;
  locationScoreValue: number;
}): number {
  return clampScore(
    input.titleScore * 0.35 +
      input.industryScore * 0.25 +
      input.companyFitScore * 0.2 +
      input.locationScoreValue * 0.2
  );
}

function profileWarning(profile: UserProfile | null): string {
  const completion = calculateProfileCompletion(profile);
  if (completion.percent === 100) {
    return "";
  }

  const missing = completion.missingFields.slice(0, 3).join(", ");
  return `Profile is incomplete; best-effort score missing ${missing}.`;
}

export class DeterministicScoringAdapter implements MatchScoringAdapter {
  modelName = DETERMINISTIC_MODEL_NAME;

  async scoreJob({ session, profile, job, existingMatch }: MatchScoringInput) {
    const timestamp = nowIso();
    const jobText = [
      job.title,
      job.company,
      job.location,
      job.description,
      job.requirements.join(" "),
      job.responsibilities.join(" ")
    ].join(" ");
    const profileTokens = profile
      ? uniqueTokens([
          ...profile.targetTitles,
          ...profile.targetIndustries,
          profile.careerSummary,
          ...profile.verifiedFacts
        ])
      : [];
    const jobTokens = uniqueTokens([jobText]);
    const weakDescription = job.description.trim().length < 120;
    const warning = profileWarning(profile);
    const companyAvoided = profile
      ? listContainsCompany(profile.companiesToAvoid, job.company)
      : false;
    const companyPrioritized = profile
      ? listContainsCompany(profile.companiesToPrioritize, job.company)
      : false;
    const titleScore = titleOverlapScore(profile, job);
    const skillsScore = weakDescription
      ? Math.min(overlapScore(profileTokens, jobTokens), 5.2)
      : overlapScore(profileTokens, jobTokens);
    const experienceScore = weakDescription
      ? 4.8
      : clampScore(overlapScore(profileTokens, jobTokens) * 0.7 + titleScore * 0.3);
    const seniorityScoreValue = seniorityScore(profile, job);
    const locationScoreValue = locationScore(profile, job);
    const salaryScoreValue = salaryScore(profile, job);
    const industryScore = scoreIndustry(profile, jobText);
    const companyFitScore = companyAvoided ? 0 : companyPrioritized ? 10 : 6.5;
    const applicationEffortScore = applicationEffortScoreForJob(job, weakDescription);
    const strategicValueScore = scoreStrategicValue({
      titleScore,
      industryScore,
      companyFitScore,
      locationScoreValue
    });
    let overallScore = clampScore(
      skillsScore * 0.22 +
        experienceScore * 0.12 +
        seniorityScoreValue * 0.11 +
        locationScoreValue * 0.12 +
        salaryScoreValue * 0.1 +
        industryScore * 0.1 +
        companyFitScore * 0.12 +
        applicationEffortScore * 0.05 +
        strategicValueScore * 0.06
    );

    if (weakDescription) {
      overallScore = Math.min(overallScore, 5.4);
    }

    if (companyAvoided) {
      overallScore = Math.min(overallScore, 2.5);
    }

    const recommendation = recommendationFromScore(overallScore, companyAvoided);
    const topMatchReasons = buildReasons({
      profile,
      job,
      skillsScore,
      seniorityScoreValue,
      locationScoreValue,
      salaryScoreValue,
      industryScore,
      companyFitScore,
      strategicValueScore
    });
    const topGaps = buildGaps({
      profile,
      job,
      profileWarning: warning,
      companyAvoided,
      skillsScore,
      locationScoreValue,
      salaryScoreValue,
      industryScore,
      weakDescription
    });

    return jobMatchSchema.parse({
      id: existingMatch?.id ?? createId("match"),
      tenantId: session.tenant.id,
      userId: session.userId,
      jobId: job.id,
      overallScore,
      skillsScore: clampScore(skillsScore),
      experienceScore: clampScore(experienceScore),
      seniorityScore: clampScore(seniorityScoreValue),
      locationScore: clampScore(locationScoreValue),
      salaryScore: clampScore(salaryScoreValue),
      industryScore: clampScore(industryScore),
      companyFitScore: clampScore(companyFitScore),
      applicationEffortScore: clampScore(applicationEffortScore),
      strategicValueScore: clampScore(strategicValueScore),
      recommendation,
      queue: queueFromRecommendation(recommendation),
      topMatchReasons,
      topGaps,
      employerLookingFor: employerLookingFor(job),
      summary: summaryForJob(job),
      recommendedNextAction: recommendedAction(recommendation, Boolean(warning)),
      scoringVersion: SCORING_VERSION,
      modelName: this.modelName,
      promptVersion: PROMPT_VERSION,
      createdAt: existingMatch?.createdAt ?? timestamp,
      updatedAt: timestamp
    });
  }
}

function applicationEffortScoreForJob(
  job: NormalizedJob,
  weakDescription: boolean
): number {
  if (weakDescription) {
    return Math.min(applicationEffortScore(job), 5);
  }

  return applicationEffortScore(job);
}

export class PlaceholderLlmScoringAdapter implements MatchScoringAdapter {
  modelName = LLM_PLACEHOLDER_MODEL_NAME;

  async scoreJob(): Promise<JobMatch> {
    throw new Error("LLM scoring adapter placeholder is not configured.");
  }
}

export function createDeterministicScoringAdapter(): MatchScoringAdapter {
  return new DeterministicScoringAdapter();
}

export function createPlaceholderLlmScoringAdapter(): MatchScoringAdapter {
  return new PlaceholderLlmScoringAdapter();
}

export function loadJobMatches(session: AppSession): JobMatch[] {
  const matches = readJson<JobMatch[]>(matchesKey(session), []);
  return matches.filter((match) => jobMatchSchema.safeParse(match).success);
}

export function saveJobMatches(
  session: AppSession,
  matches: JobMatch[]
): JobMatch[] {
  const parsed = matches.map((match) => jobMatchSchema.parse(match));
  writeJson(matchesKey(session), parsed);
  return parsed;
}

export async function scoreJobsForProfile(
  session: AppSession,
  profile: UserProfile | null,
  jobs: NormalizedJob[],
  existingMatches: JobMatch[] = loadJobMatches(session),
  adapter: MatchScoringAdapter = createDeterministicScoringAdapter()
): Promise<MatchScoringResult> {
  const existingByJobId = new Map(
    existingMatches.map((match) => [match.jobId, match] as const)
  );
  const nextMatchesByJobId = new Map(existingByJobId);
  const updatedJobs: NormalizedJob[] = [];
  let scoredCount = 0;
  let applyCount = 0;
  let maybeCount = 0;
  let browseCount = 0;
  let skipCount = 0;
  const jobIdsToScore = new Set(jobs.map((job) => job.id));

  for (const job of jobs) {
    const match = await adapter.scoreJob({
      session,
      profile,
      job,
      existingMatch: existingByJobId.get(job.id) ?? null
    });
    nextMatchesByJobId.set(job.id, match);
    scoredCount += 1;

    if (match.recommendation === "apply") {
      applyCount += 1;
    } else if (match.recommendation === "maybe") {
      maybeCount += 1;
    } else if (match.recommendation === "skip") {
      skipCount += 1;
      browseCount += 1;
    } else {
      browseCount += 1;
    }

    updatedJobs.push(
      normalizedJobSchema.parse({
        ...job,
        scoringStatus: match.recommendation === "skip" ? "skipped" : "scored",
        updatedAt: nowIso()
      })
    );
  }

  const untouchedJobs = loadNormalizedJobs(session).filter(
    (job) => !jobIdsToScore.has(job.id)
  );
  const matches = Array.from(nextMatchesByJobId.values()).sort(
    (a, b) => b.overallScore - a.overallScore
  );
  const savedMatches = saveJobMatches(session, matches);
  const savedJobs = saveNormalizedJobs(session, [...updatedJobs, ...untouchedJobs]);

  return {
    matches: savedMatches,
    jobs: savedJobs,
    scoredCount,
    applyCount,
    maybeCount,
    browseCount,
    skipCount,
    profileWarning: profileWarning(profile)
  };
}

export function createMatchEngine(
  adapter: MatchScoringAdapter = createDeterministicScoringAdapter()
): MatchEngine {
  return {
    async scoreJobs(input) {
      const session: AppSession = {
        tenant: {
          id: input.profile?.tenantId ?? "tenant_unknown",
          name: "Match engine session",
          type: "individual",
          plan: "free",
          status: "active",
          createdAt: nowIso()
        },
        userId: input.profile?.userId ?? "user_unknown"
      };

      const result = await scoreJobsForProfile(
        session,
        input.profile,
        input.jobs,
        input.existingMatches ?? [],
        adapter
      );

      return result.matches;
    }
  };
}
