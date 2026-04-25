import type {
  AppSession,
  ApplicationAnswer,
  ApplicationPackage,
  ApplicationRecord,
  AnswerConfidence,
  GenerationMode,
  JobMatch,
  NormalizedJob,
  Resume,
  UserProfile
} from "../models/domain";
import {
  applicationAnswerSchema,
  applicationPackageSchema
} from "../models/schemas";
import { readJson, scopedKey, writeJson } from "../lib/storage";
import {
  loadApplications,
  upsertApplicationRecord
} from "./applicationService";

const PROMPT_VERSION = "phase5-application-package-v1";
const DETERMINISTIC_MODEL_NAME = "deterministic-package-fallback";
const LLM_PLACEHOLDER_MODEL_NAME = "llm-package-placeholder";

const commonQuestions = [
  "Why are you interested in this role?",
  "Why this company?",
  "What makes you a strong fit?",
  "Tell us about relevant experience."
] as const;

const knownCompanyNames = [
  "Google",
  "Meta",
  "Amazon",
  "Microsoft",
  "Apple",
  "Netflix",
  "Stripe",
  "OpenAI",
  "Anthropic",
  "Salesforce",
  "Oracle",
  "IBM",
  "Uber",
  "Airbnb",
  "Tesla"
];

const knownTools = [
  "TypeScript",
  "JavaScript",
  "React",
  "Next.js",
  "Node.js",
  "Python",
  "Java",
  "Go",
  "Kubernetes",
  "Docker",
  "AWS",
  "Azure",
  "GCP",
  "SQL",
  "PostgreSQL",
  "Prisma",
  "Drizzle",
  "Playwright",
  "Terraform",
  "Salesforce",
  "Workday",
  "Greenhouse",
  "Lever"
];

const credentials = [
  "Bachelor",
  "Master",
  "MBA",
  "PhD",
  "AWS Certified",
  "PMP",
  "CPA",
  "CFA",
  "Security+",
  "CISSP"
];

export interface ApplicationPackageContext {
  profile: UserProfile | null;
  resume: Resume | null;
  job: NormalizedJob;
  match: JobMatch | null;
}

export interface ApplicationPackageGenerationRequest extends ApplicationPackageContext {
  session: AppSession;
  application: ApplicationRecord;
  adapter?: ApplicationPackageGenerator;
}

export interface GeneratedAnswerDraft {
  question: string;
  answer: string;
  confidence: AnswerConfidence;
  needsUserReview: boolean;
}

export interface GeneratedApplicationPackageContent {
  resumeMarkdown: string;
  coverLetter: string;
  answers: GeneratedAnswerDraft[];
  generationMode: GenerationMode;
  modelName: string;
  promptVersion: string;
}

export interface ApplicationPackageBundle {
  package: ApplicationPackage;
  answers: ApplicationAnswer[];
}

export interface ApplicationPackageGenerationResult extends ApplicationPackageBundle {
  warningsCreated: string[];
}

export interface ApplicationPackageGenerator {
  mode: GenerationMode;
  modelName: string;
  generate(
    request: ApplicationPackageGenerationRequest
  ): Promise<GeneratedApplicationPackageContent>;
}

function createId(prefix: string): string {
  return `${prefix}_${globalThis.crypto.randomUUID()}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function packagesKey(session: AppSession): string {
  return scopedKey(session.tenant.id, session.userId, "application_packages");
}

function answersKey(session: AppSession): string {
  return scopedKey(session.tenant.id, session.userId, "application_answers");
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9+#.$%]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function simpleHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return `h_${(hash >>> 0).toString(36)}`;
}

function usableResumeText(resume: Resume | null): string {
  if (!resume) {
    return "";
  }

  return resume.parsedText.includes("Resume parsing placeholder")
    ? ""
    : resume.parsedText;
}

function evidenceText(
  profile: UserProfile | null,
  resume: Resume | null,
  job: NormalizedJob
): string {
  return [
    profile?.fullName,
    profile?.careerSummary,
    profile?.targetTitles.join(" "),
    profile?.targetIndustries.join(" "),
    profile?.verifiedFacts.join(" "),
    usableResumeText(resume),
    job.title,
    job.company,
    job.description,
    job.requirements.join(" "),
    job.responsibilities.join(" ")
  ]
    .filter(Boolean)
    .join(" ");
}

function relevantFacts(profile: UserProfile | null, job: NormalizedJob): string[] {
  if (!profile) {
    return [];
  }

  const jobText = normalizeText(
    `${job.title} ${job.description} ${job.requirements.join(" ")} ${job.responsibilities.join(" ")}`
  );
  const scoredFacts = profile.verifiedFacts.map((fact) => ({
    fact,
    score: fact
      .split(/\s+/)
      .filter((token) => jobText.includes(normalizeText(token))).length
  }));

  const sorted = scoredFacts
    .sort((a, b) => b.score - a.score)
    .map((item) => item.fact);

  return sorted.length > 0 ? sorted.slice(0, 5) : [];
}

function confidenceFor(profile: UserProfile | null, resume: Resume | null): AnswerConfidence {
  if (profile && profile.verifiedFacts.length >= 2) {
    return "high";
  }

  if (profile?.careerSummary || usableResumeText(resume)) {
    return "medium";
  }

  return "low";
}

function factualSummary(profile: UserProfile | null): string {
  if (profile?.careerSummary) {
    return profile.careerSummary;
  }

  if (profile?.targetTitles.length) {
    return `Candidate is targeting ${profile.targetTitles.join(", ")} roles.`;
  }

  return "Candidate profile is incomplete; add verified experience before finalizing.";
}

function factBullets(facts: string[]): string {
  if (facts.length === 0) {
    return "- Add verified facts before finalizing this section.";
  }

  return facts.map((fact) => `- ${fact}`).join("\n");
}

function employerNeeds(job: NormalizedJob): string[] {
  return [...job.requirements, ...job.responsibilities].filter(Boolean).slice(0, 5);
}

function buildResumeMarkdown(
  profile: UserProfile | null,
  resume: Resume | null,
  job: NormalizedJob
): string {
  const name = profile?.fullName || "Candidate";
  const facts = relevantFacts(profile, job);
  const needs = employerNeeds(job);
  const resumeEvidence = usableResumeText(resume);

  return [
    `# ${name}`,
    "",
    `## Target Role`,
    `${job.title} at ${job.company}`,
    "",
    "## Professional Summary",
    factualSummary(profile),
    "",
    "## Relevant Verified Experience",
    factBullets(facts),
    "",
    "## Role Alignment",
    needs.length > 0
      ? needs.map((need) => `- Emphasize verified evidence related to: ${need}`).join("\n")
      : "- Job description has limited requirements; keep claims broad and truthful.",
    "",
    "## Source Resume Notes",
    resumeEvidence
      ? resumeEvidence.slice(0, 900)
      : "No parsed resume evidence is available yet. Use only verified profile facts until parsing is implemented."
  ].join("\n");
}

function buildCoverLetter(profile: UserProfile | null, job: NormalizedJob): string {
  const facts = relevantFacts(profile, job);
  const needs = employerNeeds(job);
  const fitSentence =
    facts.length > 0
      ? `My verified background includes ${facts.slice(0, 2).join("; ")}.`
      : "My profile needs more verified experience details before this letter is ready to send.";
  const needsSentence =
    needs.length > 0
      ? `The role appears to emphasize ${needs.slice(0, 2).join(" and ")}.`
      : "The posting has limited detail, so I would keep the application concise and factual.";

  return [
    "Dear hiring team,",
    "",
    `I am interested in the ${job.title} role at ${job.company}. ${needsSentence}`,
    "",
    `${fitSentence} I would welcome the chance to discuss how those verified experiences map to the role requirements.`,
    "",
    "Thank you for your consideration."
  ].join("\n");
}

function answerForQuestion(
  question: string,
  profile: UserProfile | null,
  resume: Resume | null,
  job: NormalizedJob
): GeneratedAnswerDraft {
  const confidence = confidenceFor(profile, resume);
  const facts = relevantFacts(profile, job);
  const factText =
    facts.length > 0
      ? facts.slice(0, 2).join("; ")
      : "my profile needs more verified experience details before final submission";
  let answer = "";

  if (question === "Why are you interested in this role?") {
    answer = `I am interested in the ${job.title} role because it aligns with the target work described in my profile and the posting. The strongest available evidence is: ${factText}.`;
  } else if (question === "Why this company?") {
    answer = `I am interested in ${job.company} for this specific ${job.title} opportunity. I would keep this answer focused on the role requirements until more verified company-specific context is added.`;
  } else if (question === "What makes you a strong fit?") {
    answer = `Based on verified profile facts, the strongest fit signals are: ${factText}. I would avoid adding unsupported claims until the user verifies more details.`;
  } else {
    answer = `Relevant verified experience includes: ${factText}. This answer should be reviewed and strengthened only with confirmed details from the user profile or resume.`;
  }

  return {
    question,
    answer,
    confidence,
    needsUserReview: confidence !== "high"
  };
}

function buildAnswers(
  profile: UserProfile | null,
  resume: Resume | null,
  job: NormalizedJob
): GeneratedAnswerDraft[] {
  return commonQuestions.map((question) => answerForQuestion(question, profile, resume, job));
}

function generationInputHash(
  profile: UserProfile | null,
  resume: Resume | null,
  job: NormalizedJob,
  match: JobMatch | null
): string {
  return simpleHash(
    JSON.stringify({
      profile,
      resumeText: resume?.parsedText ?? "",
      job,
      matchScore: match?.overallScore ?? null
    })
  );
}

function generationOutputHash(content: {
  resumeMarkdown: string;
  coverLetter: string;
  answers: Array<{ answer: string }>;
}): string {
  return simpleHash(
    [
      content.resumeMarkdown,
      content.coverLetter,
      ...content.answers.map((answer) => answer.answer)
    ].join("\n")
  );
}

export function checkUnsupportedClaims(input: {
  text: string;
  profile: UserProfile | null;
  resume: Resume | null;
  job: NormalizedJob;
}): string[] {
  const allowed = normalizeText(evidenceText(input.profile, input.resume, input.job));
  const verifiedFacts = normalizeText(input.profile?.verifiedFacts.join(" ") ?? "");
  const text = input.text;
  const warnings: string[] = [];

  knownCompanyNames.forEach((company) => {
    if (text.includes(company) && !allowed.includes(normalizeText(company))) {
      warnings.push(`Unsupported company mention: ${company}`);
    }
  });

  knownTools.forEach((tool) => {
    if (text.includes(tool) && !allowed.includes(normalizeText(tool))) {
      warnings.push(`Unsupported tool mention: ${tool}`);
    }
  });

  credentials.forEach((credential) => {
    if (text.includes(credential) && !allowed.includes(normalizeText(credential))) {
      warnings.push(`Unsupported degree or certification mention: ${credential}`);
    }
  });

  const metrics =
    text.match(
      /\b\d+(?:\.\d+)?\s?(?:%|x|k|m|million|billion)(?=\b|[^a-zA-Z0-9])|\$\s?\d+(?:,\d{3})*(?:\.\d+)?/gi
    ) ?? [];
  metrics.forEach((metric) => {
    if (!verifiedFacts.includes(normalizeText(metric))) {
      warnings.push(`Metric needs verification before use: ${metric}`);
    }
  });

  return Array.from(new Set(warnings));
}

function safetyWarningsForContent(
  context: ApplicationPackageContext,
  resumeMarkdown: string,
  coverLetter: string,
  answers: Array<{ answer: string }>
): string[] {
  return checkUnsupportedClaims({
    text: [
      resumeMarkdown,
      coverLetter,
      ...answers.map((answer) => answer.answer)
    ].join("\n"),
    profile: context.profile,
    resume: context.resume,
    job: context.job
  });
}

export class DeterministicApplicationPackageGenerator implements ApplicationPackageGenerator {
  mode: GenerationMode = "deterministic";
  modelName = DETERMINISTIC_MODEL_NAME;

  async generate(request: ApplicationPackageGenerationRequest) {
    return {
      resumeMarkdown: buildResumeMarkdown(request.profile, request.resume, request.job),
      coverLetter: buildCoverLetter(request.profile, request.job),
      answers: buildAnswers(request.profile, request.resume, request.job),
      generationMode: this.mode,
      modelName: this.modelName,
      promptVersion: PROMPT_VERSION
    };
  }
}

export class PlaceholderLlmApplicationPackageGenerator implements ApplicationPackageGenerator {
  mode: GenerationMode = "llm";
  modelName = LLM_PLACEHOLDER_MODEL_NAME;

  async generate(): Promise<GeneratedApplicationPackageContent> {
    throw new Error("LLM application package generation is not configured.");
  }
}

export function createDeterministicApplicationPackageGenerator(): ApplicationPackageGenerator {
  return new DeterministicApplicationPackageGenerator();
}

export function createPlaceholderLlmApplicationPackageGenerator(): ApplicationPackageGenerator {
  return new PlaceholderLlmApplicationPackageGenerator();
}

export function loadApplicationPackages(session: AppSession): ApplicationPackage[] {
  const packages = readJson<ApplicationPackage[]>(packagesKey(session), []);
  return packages.filter((applicationPackage) =>
    applicationPackageSchema.safeParse(applicationPackage).success
  );
}

export function saveApplicationPackages(
  session: AppSession,
  packages: ApplicationPackage[]
): ApplicationPackage[] {
  const parsed = packages.map((applicationPackage) =>
    applicationPackageSchema.parse(applicationPackage)
  );
  writeJson(packagesKey(session), parsed);
  return parsed;
}

export function loadApplicationAnswers(session: AppSession): ApplicationAnswer[] {
  const answers = readJson<ApplicationAnswer[]>(answersKey(session), []);
  return answers.filter((answer) => applicationAnswerSchema.safeParse(answer).success);
}

export function saveApplicationAnswers(
  session: AppSession,
  answers: ApplicationAnswer[]
): ApplicationAnswer[] {
  const parsed = answers.map((answer) => applicationAnswerSchema.parse(answer));
  writeJson(answersKey(session), parsed);
  return parsed;
}

export function getPackageBundle(
  session: AppSession,
  packageId: string
): ApplicationPackageBundle | null {
  const applicationPackage = loadApplicationPackages(session).find(
    (item) => item.id === packageId
  );
  if (!applicationPackage) {
    return null;
  }

  return {
    package: applicationPackage,
    answers: loadApplicationAnswers(session).filter(
      (answer) => answer.applicationPackageId === packageId
    )
  };
}

export function getPackageForApplication(
  session: AppSession,
  applicationRecordId: string
): ApplicationPackage | null {
  return (
    loadApplicationPackages(session).find(
      (applicationPackage) =>
        applicationPackage.applicationRecordId === applicationRecordId
    ) ?? null
  );
}

export async function generateApplicationPackage(
  request: ApplicationPackageGenerationRequest
): Promise<ApplicationPackageGenerationResult> {
  const adapter = request.adapter ?? createDeterministicApplicationPackageGenerator();
  const generated = await adapter.generate(request);
  const timestamp = nowIso();
  const existingPackage = loadApplicationPackages(request.session).find(
    (applicationPackage) =>
      applicationPackage.applicationRecordId === request.application.id
  );
  const safetyWarnings = safetyWarningsForContent(
    request,
    generated.resumeMarkdown,
    generated.coverLetter,
    generated.answers
  );
  const applicationPackage = applicationPackageSchema.parse({
    id: existingPackage?.id ?? createId("pkg"),
    tenantId: request.session.tenant.id,
    userId: request.session.userId,
    jobId: request.job.id,
    applicationRecordId: request.application.id,
    status: "ready_for_review",
    resumeMarkdown: generated.resumeMarkdown,
    coverLetter: generated.coverLetter,
    generationMode: generated.generationMode,
    modelName: generated.modelName,
    promptVersion: generated.promptVersion,
    inputHash: generationInputHash(
      request.profile,
      request.resume,
      request.job,
      request.match
    ),
    outputHash: generationOutputHash(generated),
    safetyWarnings,
    createdAt: existingPackage?.createdAt ?? timestamp,
    updatedAt: timestamp,
    approvedAt: null,
    rejectedAt: null
  });
  const packages = loadApplicationPackages(request.session);
  saveApplicationPackages(
    request.session,
    existingPackage
      ? packages.map((item) =>
          item.id === applicationPackage.id ? applicationPackage : item
        )
      : [applicationPackage, ...packages]
  );

  const existingAnswers = loadApplicationAnswers(request.session).filter(
    (answer) => answer.applicationPackageId !== applicationPackage.id
  );
  const answers = generated.answers.map((answer) =>
    applicationAnswerSchema.parse({
      id: createId("ans"),
      tenantId: request.session.tenant.id,
      userId: request.session.userId,
      applicationPackageId: applicationPackage.id,
      question: answer.question,
      answer: answer.answer,
      confidence: answer.confidence,
      source: "generated",
      needsUserReview: answer.needsUserReview,
      createdAt: timestamp,
      updatedAt: timestamp
    })
  );
  saveApplicationAnswers(request.session, [...answers, ...existingAnswers]);

  return {
    package: applicationPackage,
    answers,
    warningsCreated: safetyWarnings
  };
}

export function updateApplicationPackageDraft(
  session: AppSession,
  packageId: string,
  updates: {
    resumeMarkdown: string;
    coverLetter: string;
  },
  context: ApplicationPackageContext
): ApplicationPackageGenerationResult {
  const packages = loadApplicationPackages(session);
  const existing = packages.find(
    (applicationPackage) => applicationPackage.id === packageId
  );
  if (!existing) {
    throw new Error("Application package was not found.");
  }

  const answers = loadApplicationAnswers(session).filter(
    (answer) => answer.applicationPackageId === packageId
  );
  const safetyWarnings = safetyWarningsForContent(
    context,
    updates.resumeMarkdown,
    updates.coverLetter,
    answers
  );
  const updated = applicationPackageSchema.parse({
    ...existing,
    status: existing.status === "approved" ? "ready_for_review" : existing.status,
    resumeMarkdown: updates.resumeMarkdown,
    coverLetter: updates.coverLetter,
    outputHash: generationOutputHash({
      resumeMarkdown: updates.resumeMarkdown,
      coverLetter: updates.coverLetter,
      answers
    }),
    safetyWarnings,
    updatedAt: nowIso(),
    approvedAt: existing.status === "approved" ? null : existing.approvedAt
  });

  saveApplicationPackages(
    session,
    packages.map((applicationPackage) =>
      applicationPackage.id === packageId ? updated : applicationPackage
    )
  );

  return {
    package: updated,
    answers,
    warningsCreated: safetyWarnings
  };
}

export function updateApplicationAnswerDraft(
  session: AppSession,
  answerId: string,
  answerText: string,
  context: ApplicationPackageContext
): ApplicationPackageGenerationResult {
  const answers = loadApplicationAnswers(session);
  const existingAnswer = answers.find((answer) => answer.id === answerId);
  if (!existingAnswer) {
    throw new Error("Application answer was not found.");
  }

  const updatedAnswer = applicationAnswerSchema.parse({
    ...existingAnswer,
    answer: answerText,
    source: "user_edited",
    confidence: "high",
    needsUserReview: false,
    updatedAt: nowIso()
  });
  const nextAnswers = answers.map((answer) =>
    answer.id === answerId ? updatedAnswer : answer
  );
  saveApplicationAnswers(session, nextAnswers);

  const applicationPackage = loadApplicationPackages(session).find(
    (item) => item.id === updatedAnswer.applicationPackageId
  );
  if (!applicationPackage) {
    throw new Error("Application package was not found.");
  }

  const packageAnswers = nextAnswers.filter(
    (answer) => answer.applicationPackageId === applicationPackage.id
  );
  const safetyWarnings = safetyWarningsForContent(
    context,
    applicationPackage.resumeMarkdown,
    applicationPackage.coverLetter,
    packageAnswers
  );
  const updatedPackage = applicationPackageSchema.parse({
    ...applicationPackage,
    status:
      applicationPackage.status === "approved"
        ? "ready_for_review"
        : applicationPackage.status,
    outputHash: generationOutputHash({
      resumeMarkdown: applicationPackage.resumeMarkdown,
      coverLetter: applicationPackage.coverLetter,
      answers: packageAnswers
    }),
    safetyWarnings,
    updatedAt: nowIso(),
    approvedAt: applicationPackage.status === "approved" ? null : applicationPackage.approvedAt
  });

  saveApplicationPackages(
    session,
    loadApplicationPackages(session).map((item) =>
      item.id === updatedPackage.id ? updatedPackage : item
    )
  );

  return {
    package: updatedPackage,
    answers: packageAnswers,
    warningsCreated: safetyWarnings
  };
}

export function approveApplicationPackage(
  session: AppSession,
  packageId: string
): {
  package: ApplicationPackage;
  application: ApplicationRecord;
  packages: ApplicationPackage[];
  applications: ApplicationRecord[];
} {
  const packages = loadApplicationPackages(session);
  const existing = packages.find(
    (applicationPackage) => applicationPackage.id === packageId
  );
  if (!existing) {
    throw new Error("Application package was not found.");
  }

  const timestamp = nowIso();
  const updated = applicationPackageSchema.parse({
    ...existing,
    status: "approved",
    approvedAt: timestamp,
    rejectedAt: null,
    updatedAt: timestamp
  });
  const savedPackages = saveApplicationPackages(
    session,
    packages.map((applicationPackage) =>
      applicationPackage.id === packageId ? updated : applicationPackage
    )
  );
  const application = upsertApplicationRecord(session, existing.jobId, {
    status: "approved"
  });

  return {
    package: updated,
    application,
    packages: savedPackages,
    applications: loadApplications(session)
  };
}

export function rejectApplicationPackage(
  session: AppSession,
  packageId: string
): {
  package: ApplicationPackage;
  application: ApplicationRecord;
  packages: ApplicationPackage[];
  applications: ApplicationRecord[];
} {
  const packages = loadApplicationPackages(session);
  const existing = packages.find(
    (applicationPackage) => applicationPackage.id === packageId
  );
  if (!existing) {
    throw new Error("Application package was not found.");
  }

  const timestamp = nowIso();
  const updated = applicationPackageSchema.parse({
    ...existing,
    status: "rejected",
    approvedAt: null,
    rejectedAt: timestamp,
    updatedAt: timestamp
  });
  const savedPackages = saveApplicationPackages(
    session,
    packages.map((applicationPackage) =>
      applicationPackage.id === packageId ? updated : applicationPackage
    )
  );
  const application = upsertApplicationRecord(session, existing.jobId, {
    status: "needs_review"
  });

  return {
    package: updated,
    application,
    packages: savedPackages,
    applications: loadApplications(session)
  };
}
