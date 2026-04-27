import type {
  AppSession,
  AtsRiskLevel,
  AuditLog,
  ExtractedResumeProfile,
  JobTargetRecommendation,
  RecommendedRole,
  RecommendedRoleFitLevel,
  Resume,
  ResumeFieldConfidenceMap,
  ResumeIntelligenceMode,
  ResumeIntelligenceProvider,
  ResumeIntelligenceReport,
  ResumeIntelligenceSuggestedFix,
  SkillGap,
  ResumeFieldConfidence
} from "../models/domain";
import {
  jobTargetRecommendationSchema,
  resumeIntelligenceReportSchema
} from "../models/schemas";
import { readJson, scopedKey, writeJson } from "../lib/storage";
import { pickOpenAIAdapterIfConfigured } from "./openaiResumeIntelligenceAdapter";
import {
  ApiResumeIntelligenceUnavailableError,
  callResumeIntelligenceApi,
  type ApiClientOptions
} from "./resumeIntelligenceApiClient";

type AuditMetadata = AuditLog["metadata"];

/**
 * Phase 14 — Resume intelligence service.
 *
 * - Deterministic-first. Output is best-effort context, not authoritative
 *   truth. Adapters never invent experience, skills, or metrics. Anything
 *   uncertain is marked needsUserReview via low confidence.
 * - LLM boundary is exposed but throws until configured.
 * - The service stores model + prompt metadata on every report. Raw resume
 *   content is never copied into audit logs or downstream events.
 */

export interface ResumeIntelligenceAuditEvent {
  action: string;
  resourceType: string;
  resourceId: string;
  metadata: AuditMetadata;
}

export interface ResumeIntelligenceAdapterOutput {
  modelName: string;
  promptVersion: string;
  extractionMode: ResumeIntelligenceMode;
  /**
   * Concrete provider that produced this output. Lets the UI
   * distinguish OpenAI from Azure OpenAI even though both run in
   * `extractionMode: "llm"`.
   */
  provider: ResumeIntelligenceProvider;
  extractedProfile: ExtractedResumeProfile;
  confidenceByField: ResumeFieldConfidenceMap;
  missingFields: string[];
  ambiguousFields: string[];
  parsingWarnings: string[];
  atsRiskScore: number;
  atsRiskLevel: AtsRiskLevel;
  suggestedFixes: ResumeIntelligenceSuggestedFix[];
  recommendation: {
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
  };
}

export interface ResumeIntelligenceAdapter {
  name: string;
  analyze(input: { resume: Resume }): Promise<ResumeIntelligenceAdapterOutput>;
}

export interface AnalyzeResumeResult {
  report: ResumeIntelligenceReport;
  recommendation: JobTargetRecommendation;
  auditEvents: ResumeIntelligenceAuditEvent[];
}

const REPORTS_KEY = "resume_intelligence_reports";
const RECOMMENDATIONS_KEY = "job_target_recommendations";

function nowIso(): string {
  return new Date().toISOString();
}

function createId(prefix: string): string {
  return `${prefix}_${globalThis.crypto.randomUUID()}`;
}

function reportsKey(session: AppSession): string {
  return scopedKey(session.tenant.id, session.userId, REPORTS_KEY);
}

function recommendationsKey(session: AppSession): string {
  return scopedKey(session.tenant.id, session.userId, RECOMMENDATIONS_KEY);
}

export function loadResumeIntelligenceReports(
  session: AppSession
): ResumeIntelligenceReport[] {
  const records = readJson<ResumeIntelligenceReport[]>(reportsKey(session), []);
  return records.filter(
    (record) => resumeIntelligenceReportSchema.safeParse(record).success
  );
}

export function saveResumeIntelligenceReports(
  session: AppSession,
  records: ResumeIntelligenceReport[]
): ResumeIntelligenceReport[] {
  const parsed = records.map((record) =>
    resumeIntelligenceReportSchema.parse(record)
  );
  writeJson(reportsKey(session), parsed.slice(0, 50));
  return parsed;
}

export function loadJobTargetRecommendations(
  session: AppSession
): JobTargetRecommendation[] {
  const records = readJson<JobTargetRecommendation[]>(
    recommendationsKey(session),
    []
  );
  return records.filter(
    (record) => jobTargetRecommendationSchema.safeParse(record).success
  );
}

export function saveJobTargetRecommendations(
  session: AppSession,
  records: JobTargetRecommendation[]
): JobTargetRecommendation[] {
  const parsed = records.map((record) =>
    jobTargetRecommendationSchema.parse(record)
  );
  writeJson(recommendationsKey(session), parsed.slice(0, 50));
  return parsed;
}

export function getResumeIntelligenceReport(
  session: AppSession,
  resumeId: string
): ResumeIntelligenceReport | null {
  return (
    loadResumeIntelligenceReports(session).find(
      (record) => record.resumeId === resumeId
    ) ?? null
  );
}

export function getJobTargetRecommendation(
  session: AppSession,
  resumeId: string
): JobTargetRecommendation | null {
  return (
    loadJobTargetRecommendations(session).find(
      (record) => record.resumeId === resumeId
    ) ?? null
  );
}

// ---------------------------------------------------------------------------
// Deterministic adapter
// ---------------------------------------------------------------------------

const SKILL_KEYWORDS: Record<string, string[]> = {
  TypeScript: ["typescript", "ts"],
  JavaScript: ["javascript", "node.js", "nodejs"],
  React: ["react"],
  Python: ["python"],
  SQL: ["sql"],
  "Data analysis": ["analytics", "analyst", "tableau", "looker"],
  "Machine learning": ["machine learning", "ml ", " ml"],
  LLM: ["llm", "gpt", "claude"],
  "Product management": ["product manager", "product management", "pm "],
  "Customer discovery": ["customer discovery", "customer research", "user research"],
  "Roadmap": ["roadmap"],
  Leadership: ["leader", "led ", "manager", "director", "head of"],
  "B2B SaaS": ["b2b saas", "saas"],
  "Workflow automation": ["workflow automation"],
  Postgres: ["postgres", "postgresql"],
  Snowflake: ["snowflake"],
  Airflow: ["airflow"],
  Docker: ["docker"],
  Kubernetes: ["kubernetes", "k8s"],
  AWS: ["aws", "amazon web services"],
  GCP: ["gcp", "google cloud"],
  Figma: ["figma"]
};

const INDUSTRY_KEYWORDS: Record<string, string[]> = {
  "B2B SaaS": ["b2b saas", "saas"],
  "Workflow automation": ["workflow automation"],
  Fintech: ["fintech", "payments", "banking"],
  Healthcare: ["healthcare", "biotech", "medical"],
  "Developer infrastructure": ["developer tools", "infrastructure"],
  Marketplace: ["marketplace"],
  Consumer: ["consumer", "b2c"]
};

const SENIORITY_KEYWORDS: Array<{ level: string; keywords: string[] }> = [
  { level: "Director / VP", keywords: ["vp ", "director", "head of"] },
  { level: "Staff / Principal", keywords: ["staff ", "principal "] },
  { level: "Senior", keywords: ["senior ", "sr. ", "sr "] },
  { level: "Mid-level", keywords: ["mid level", "mid-level"] },
  { level: "Entry-level", keywords: ["entry level", "junior", "intern"] }
];

const ROLE_FAMILIES: Array<{
  name: string;
  keywords: string[];
  strongRoles: string[];
  adjacentRoles: string[];
  stretchRoles: string[];
  industries: string[];
  searchKeywords: string[];
  positioningHint: string;
  topSkillGaps: SkillGap[];
}> = [
  {
    name: "Product",
    keywords: [
      "product manager",
      "product management",
      "roadmap",
      "stakeholder",
      "user research",
      "customer discovery",
      "pm "
    ],
    strongRoles: ["Senior Product Manager", "Product Manager"],
    adjacentRoles: ["Senior Product Analyst", "Product Operations Lead"],
    stretchRoles: ["Staff Product Manager", "Director of Product"],
    industries: ["B2B SaaS", "Workflow Automation"],
    searchKeywords: ["product manager", "PM", "roadmap", "discovery"],
    positioningHint:
      "Lead with measurable customer-discovery wins and shipped roadmap outcomes; stay specific about scope.",
    topSkillGaps: [
      {
        skill: "Quantified outcomes",
        importance: "high",
        reason:
          "Strong PM applications usually quote concrete percentage/revenue/retention deltas.",
        howToClose:
          "Add 1–2 quantified achievements per role on the resume (e.g., 'shipped X feature, +12% activation')."
      }
    ]
  },
  {
    name: "Data",
    keywords: [
      "data analyst",
      "data engineer",
      "data scientist",
      "sql",
      "pipelines",
      "analytics",
      "warehouse",
      "etl",
      "snowflake",
      "tableau",
      "looker"
    ],
    strongRoles: ["Senior Data Analyst", "Senior Data Engineer"],
    adjacentRoles: ["Analytics Engineer", "Senior Data Scientist"],
    stretchRoles: ["Staff Data Scientist", "Head of Analytics"],
    industries: ["B2B SaaS", "Fintech"],
    searchKeywords: ["analytics", "data engineer", "SQL", "pipelines"],
    positioningHint:
      "Lead with the data systems you owned end-to-end and the business decisions they unblocked.",
    topSkillGaps: [
      {
        skill: "Modern warehouse stack",
        importance: "medium",
        reason:
          "Hiring teams expect direct experience with at least one warehouse + transformation tool.",
        howToClose:
          "Mention Snowflake/BigQuery + dbt experience explicitly if present; ship a small portfolio dbt project if not."
      }
    ]
  },
  {
    name: "AI",
    keywords: [
      "llm",
      "agents",
      "rag",
      "model evals",
      "prompt",
      "ml ",
      "machine learning",
      "gpt",
      "claude"
    ],
    strongRoles: ["AI Product Manager", "AI Engineer"],
    adjacentRoles: ["AI Program Manager", "Applied AI Engineer"],
    stretchRoles: ["Staff AI Engineer", "Head of AI"],
    industries: ["B2B SaaS", "Developer infrastructure"],
    searchKeywords: ["AI", "LLM", "RAG", "agents", "evals"],
    positioningHint:
      "Lead with a shipped LLM/agent product, evals you ran, and the safety guardrails you put in place.",
    topSkillGaps: [
      {
        skill: "Evaluation pipelines",
        importance: "high",
        reason:
          "Hiring teams care about how you measure quality and safety, not just shipping demos.",
        howToClose:
          "Document one eval suite you built (cases, metrics, what you changed) on the resume or in a portfolio."
      }
    ]
  },
  {
    name: "Leadership",
    keywords: ["led ", "managed", "head of", "director", "engineering manager"],
    strongRoles: ["Engineering Manager", "Senior Program Manager"],
    adjacentRoles: ["Product Lead", "Technical Program Manager"],
    stretchRoles: ["Director of Engineering", "Director of Product"],
    industries: ["B2B SaaS"],
    searchKeywords: ["engineering manager", "EM", "PgM", "lead"],
    positioningHint:
      "Lead with team scope (size, function), the bar you raised, and the cross-functional outcomes you owned.",
    topSkillGaps: [
      {
        skill: "Hiring track record",
        importance: "medium",
        reason:
          "Hiring managers ask about ramp + retention; quantify the team you scaled.",
        howToClose:
          "Add team-size deltas and ramp metrics (e.g., 'scaled team from 4 to 9, no regrettable attrition')."
      }
    ]
  },
  {
    name: "Sales",
    keywords: [
      "account executive",
      "sales",
      "crm",
      "pipeline",
      "customer success",
      "salesforce",
      "quota"
    ],
    strongRoles: ["Account Executive", "Senior Customer Success Manager"],
    adjacentRoles: ["Sales Operations Manager", "Customer Success Lead"],
    stretchRoles: ["Director of Sales", "Director of Customer Success"],
    industries: ["B2B SaaS"],
    searchKeywords: ["account executive", "AE", "customer success", "CS"],
    positioningHint:
      "Lead with quota attainment, deal sizes, retention, and the playbook you built.",
    topSkillGaps: [
      {
        skill: "Quota attainment numbers",
        importance: "high",
        reason: "Sales hiring is heavily quantitative.",
        howToClose:
          "Always include % of quota and dollar attainment per year on the resume."
      }
    ]
  }
];

function emailFromText(text: string): string {
  const match = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? match[0] : "";
}

function phoneFromText(text: string): string {
  const matches = text.match(/\+?\d[\d\s().-]{6,}\d/g) ?? [];
  for (const candidate of matches) {
    const trimmed = candidate.trim();
    // Reject obvious year ranges ("2022 - 2026", "2018-2024").
    if (/^\d{4}\s*[-–]\s*\d{4}$/.test(trimmed)) continue;
    const digits = trimmed.replace(/[^0-9]/g, "");
    if (digits.length >= 10 && digits.length <= 15) {
      return trimmed;
    }
  }
  return "";
}

function urlFromText(text: string, host: string): string {
  const pattern = new RegExp(
    `https?:\\/\\/(?:www\\.)?${host.replace(/\./g, "\\.")}\\/[A-Za-z0-9._\\-/?=&%]+`,
    "i"
  );
  const match = text.match(pattern);
  return match ? match[0] : "";
}

function locationFromText(text: string): string {
  if (/remote/i.test(text)) return "Remote";
  const match = text.match(
    /\b(?:San Francisco|New York|NYC|Brooklyn|Seattle|Austin|Boston|Chicago|Denver|London|Berlin|Tokyo|Singapore|Toronto|Vancouver|Sydney|Dublin)\b/i
  );
  return match ? match[0] : "";
}

function nameFromText(text: string): string {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  for (const line of lines.slice(0, 5)) {
    if (line.length > 60) continue;
    if (line.includes("@")) continue;
    if (/\d/.test(line)) continue;
    const words = line.split(/\s+/);
    if (words.length < 2 || words.length > 5) continue;
    if (words.every((word) => /^[A-Z][a-zA-Z'\-]+$/.test(word))) {
      return line;
    }
  }
  return "";
}

function yearsExperienceFromText(text: string): number | null {
  const explicit = text.match(/(\d{1,2})\+?\s+years?(?:\s+of)?\s+experience/i);
  if (explicit) return Number.parseInt(explicit[1], 10);
  const yearRange = text.match(/(\d{4})\s*[–-]\s*(\d{4}|present|current)/i);
  if (yearRange) {
    const start = Number.parseInt(yearRange[1], 10);
    const end = /present|current/i.test(yearRange[2])
      ? new Date().getFullYear()
      : Number.parseInt(yearRange[2], 10);
    if (Number.isFinite(start) && Number.isFinite(end) && end >= start) {
      return end - start;
    }
  }
  return null;
}

/**
 * Strip leading bullet markers (e.g. "- ", "• ", "* ") from a line so
 * the UI's own bullet glyph doesn't double up into "• -" or "- •". Handles
 * interleaved bullets+spaces ("- • Led ...") by consuming groups of
 * (bullet, optional whitespace) repeatedly. Keeps other punctuation
 * untouched and never strips lines that don't start with a bullet glyph,
 * so legitimate leading whitespace-only content survives unchanged.
 */
function stripLeadingBullet(line: string): string {
  return line.replace(/^[\s]*(?:[-*•·●◦▪▫–—][\s]*)+/, "").trim();
}

function quantifiedAchievementsFromText(text: string): string[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return lines
    .filter((line) => /(\d+\s*%)|\$\d|\d{2,}\s*(users|customers|hires|teams)/i.test(line))
    .map(stripLeadingBullet)
    .filter((line) => line.length > 0)
    .slice(0, 5);
}

function leadershipExamplesFromText(text: string): string[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return lines
    .filter((line) =>
      /(led|managed|grew|scaled|hired|owned|partnered with|founded)/i.test(line)
    )
    .map(stripLeadingBullet)
    .filter((line) => line.length > 0)
    .slice(0, 5);
}

function projectsFromText(text: string): string[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return lines
    .filter((line) =>
      /(launched|shipped|built|introduced|migrated|delivered)/i.test(line)
    )
    .map(stripLeadingBullet)
    .filter((line) => line.length > 0)
    .slice(0, 5);
}

function detectSkills(text: string): string[] {
  const lower = text.toLowerCase();
  const found: string[] = [];
  Object.entries(SKILL_KEYWORDS).forEach(([skill, keywords]) => {
    if (keywords.some((keyword) => lower.includes(keyword))) {
      found.push(skill);
    }
  });
  return found;
}

function detectIndustries(text: string): string[] {
  const lower = text.toLowerCase();
  const found: string[] = [];
  Object.entries(INDUSTRY_KEYWORDS).forEach(([industry, keywords]) => {
    if (keywords.some((keyword) => lower.includes(keyword))) {
      found.push(industry);
    }
  });
  return found;
}

function detectSeniority(text: string): string {
  const lower = text.toLowerCase();
  for (const entry of SENIORITY_KEYWORDS) {
    if (entry.keywords.some((keyword) => lower.includes(keyword))) {
      return entry.level;
    }
  }
  return "";
}

function detectCurrentTitle(text: string): string {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  // Look in the top 12 lines for a line that matches one of the role family
  // titles or contains common title words.
  for (const line of lines.slice(0, 12)) {
    if (line.length > 80) continue;
    const lower = line.toLowerCase();
    if (
      /(manager|engineer|designer|analyst|scientist|director|lead|recruiter|specialist)/i.test(
        line
      ) &&
      !lower.includes("@")
    ) {
      return line;
    }
  }
  return "";
}

function detectEducation(text: string): string[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return lines
    .filter((line) => /(university|college|b\.?s\.?|m\.?s\.?|mba|phd|bachelor|master)/i.test(line))
    .slice(0, 4);
}

function detectCertifications(text: string): string[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return lines
    .filter((line) => /(certified|certification|aws certified|gcp certified|pmp)/i.test(line))
    .slice(0, 3);
}

function detectCompanies(text: string): string[] {
  // Heuristic: look for "at <Company>" patterns or capitalised tokens after "—".
  const matches = Array.from(text.matchAll(/\bat\s+([A-Z][A-Za-z0-9&.\- ]{2,40})/g));
  const out = matches
    .map((match) => match[1].trim())
    .filter((value) => !/[.@]/.test(value))
    .slice(0, 5);
  return Array.from(new Set(out));
}

function detectJobTitles(text: string): string[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return lines
    .filter((line) =>
      /^(senior|staff|principal|lead|director|head|product|engineering|software|data|design)/i.test(
        line
      )
    )
    .slice(0, 6);
}

function workAuthorizationFromText(text: string): string {
  if (/authoriz(e|i)d to work/i.test(text)) {
    const match = text.match(/authoriz(?:ed|ied) to work[^.\n]*/i);
    return match ? match[0] : "Authorized to work";
  }
  if (/visa sponsorship/i.test(text)) {
    return "Visa sponsorship discussion required";
  }
  return "";
}

function detectMatchedFamily(text: string) {
  const lower = text.toLowerCase();
  const scored = ROLE_FAMILIES.map((family) => {
    const evidence = family.keywords.filter((keyword) => lower.includes(keyword));
    return { family, score: evidence.length, evidence };
  })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored;
}

function buildRecommendedRole(
  title: string,
  fitLevel: RecommendedRoleFitLevel,
  evidence: string[],
  searchKeywords: string[],
  positioningHint: string,
  why: string,
  confidence: ResumeFieldConfidence
): RecommendedRole {
  return {
    title,
    fitLevel,
    confidence,
    why,
    evidenceFromResume: evidence,
    searchKeywords,
    suggestedResumeAngle: positioningHint
  };
}

function deterministicConfidenceMap(
  profile: ExtractedResumeProfile
): ResumeFieldConfidenceMap {
  const present = (value: string | string[] | number | null) =>
    Array.isArray(value)
      ? value.length > 0
      : value !== null && value !== undefined && String(value).trim().length > 0;
  return {
    fullName: present(profile.fullName) ? "high" : "low",
    email: present(profile.email) ? "high" : "low",
    phone: present(profile.phone) ? "medium" : "low",
    location: present(profile.location) ? "medium" : "low",
    linkedinUrl: present(profile.linkedinUrl) ? "high" : "low",
    githubUrl: present(profile.githubUrl) ? "medium" : "low",
    portfolioUrl: present(profile.portfolioUrl) ? "medium" : "low",
    currentTitle: present(profile.currentTitle) ? "medium" : "low",
    seniorityLevel: present(profile.seniorityLevel) ? "medium" : "low",
    yearsOfExperience: present(profile.yearsOfExperience) ? "medium" : "low",
    skills: profile.skills.length >= 5 ? "high" : profile.skills.length > 0 ? "medium" : "low",
    industries: profile.industries.length > 0 ? "medium" : "low"
  };
}

function buildAtsRiskAssessment(
  profile: ExtractedResumeProfile,
  text: string
): {
  parsingWarnings: string[];
  suggestedFixes: ResumeIntelligenceSuggestedFix[];
  missingFields: string[];
  ambiguousFields: string[];
  atsRiskScore: number;
  atsRiskLevel: AtsRiskLevel;
} {
  const parsingWarnings: string[] = [];
  const suggestedFixes: ResumeIntelligenceSuggestedFix[] = [];
  const missingFields: string[] = [];
  const ambiguousFields: string[] = [];
  let score = 0;

  function add(
    field: string,
    severity: AtsRiskLevel,
    weight: number,
    message: string,
    recommendedAction: string
  ) {
    parsingWarnings.push(message);
    suggestedFixes.push({ field, severity, message, recommendedAction });
    score += weight;
  }

  if (!profile.email) {
    missingFields.push("email");
    add(
      "email",
      "high",
      30,
      "No email detected on the resume.",
      "Add a clearly formatted email near the top of the resume."
    );
  }
  if (!profile.phone) {
    missingFields.push("phone");
    add(
      "phone",
      "medium",
      15,
      "No phone number detected.",
      "Add a phone number formatted as +1 555-555-0100."
    );
  }
  if (!profile.location) {
    missingFields.push("location");
    add(
      "location",
      "low",
      5,
      "No city or 'Remote' line detected.",
      "Add the city you live in (or 'Remote') near the contact info."
    );
  }
  if (!profile.linkedinUrl) {
    missingFields.push("linkedinUrl");
    add(
      "linkedinUrl",
      "low",
      5,
      "No LinkedIn URL detected.",
      "Add a public LinkedIn URL on its own line."
    );
  }
  if (!profile.currentTitle) {
    ambiguousFields.push("currentTitle");
    add(
      "currentTitle",
      "medium",
      15,
      "Current title is unclear.",
      "Make the most recent role's title prominent (its own line) so ATS parsers can pick it up."
    );
  }
  if (profile.jobTitles.length === 0) {
    ambiguousFields.push("recentRoles");
    add(
      "recentRoles",
      "medium",
      10,
      "No clear recent roles detected.",
      "Format each role as 'Title — Company — Dates' on its own line."
    );
  }
  if (profile.quantifiedAchievements.length === 0) {
    ambiguousFields.push("quantifiedAchievements");
    add(
      "quantifiedAchievements",
      "medium",
      15,
      "No measurable achievements detected.",
      "Add 1–2 quantified outcomes per role (e.g., 'increased activation 12%')."
    );
  }
  if (!/(\d{4})\s*[–-]\s*(\d{4}|present|current)/i.test(text)) {
    ambiguousFields.push("dates");
    add(
      "dates",
      "low",
      5,
      "Dates appear inconsistent or unclear.",
      "Use a consistent 'Mon YYYY – Mon YYYY' or 'YYYY – YYYY' format."
    );
  }
  if (/\|/.test(text)) {
    add(
      "layout",
      "medium",
      10,
      "Resume appears to use a multi-column or table layout (pipes detected).",
      "Switch to a single-column layout so ATS parsers extract fields reliably."
    );
  }
  if (/[▀-▟■-◿]/.test(text)) {
    add(
      "layout",
      "medium",
      10,
      "Decorative blocks/icons detected; ATS parsers can drop them.",
      "Replace icon glyphs with plain text labels."
    );
  }
  if (/[©®™]|^\s+image|\bsvg\b/i.test(text)) {
    add(
      "layout",
      "low",
      5,
      "Possible image/icon references detected.",
      "Avoid image-only logos and skill bars; use plain text."
    );
  }
  if (text.length < 500) {
    add(
      "length",
      "high",
      20,
      "Resume text is very short; the parser may have missed sections.",
      "Re-export as text-based PDF and confirm content is selectable."
    );
  }
  if (profile.skills.length === 0) {
    add(
      "skills",
      "medium",
      10,
      "No skills section detected.",
      "Add a clearly labelled 'Skills' section listing your top 8–12 tools."
    );
  }
  if (profile.education.length === 0) {
    add(
      "education",
      "low",
      5,
      "No education section detected.",
      "Add an 'Education' line with school + degree where applicable."
    );
  }

  const clamped = Math.min(100, score);
  let level: AtsRiskLevel = "low";
  if (clamped >= 50) level = "high";
  else if (clamped >= 25) level = "medium";

  return {
    parsingWarnings,
    suggestedFixes,
    missingFields,
    ambiguousFields,
    atsRiskScore: clamped,
    atsRiskLevel: level
  };
}

function buildRoleRecommendations(
  text: string,
  profile: ExtractedResumeProfile
): ResumeIntelligenceAdapterOutput["recommendation"] {
  const matched = detectMatchedFamily(text);
  const strongest: RecommendedRole[] = [];
  const adjacent: RecommendedRole[] = [];
  const stretch: RecommendedRole[] = [];
  const avoid: RecommendedRole[] = [];
  const industries = new Set<string>();
  const searchKeywords = new Set<string>();
  const skillGaps: SkillGap[] = [];
  const positioningAdvice: string[] = [];

  if (matched.length === 0) {
    // No clear family — push only adjacent suggestions and let the user
    // tell us what they want. Never stamp a strong fit without evidence.
    return {
      strongestRoles: [],
      adjacentRoles: [
        {
          title: "Tell us your target role",
          fitLevel: "adjacent",
          confidence: "low",
          why:
            "We could not find clear evidence of a single role family on this resume. Add a few target roles below so we can recommend jobs.",
          evidenceFromResume: [],
          searchKeywords: [],
          suggestedResumeAngle:
            "Lead with the most recent role and 1–2 quantified outcomes."
        }
      ],
      stretchRoles: [],
      rolesToAvoid: [],
      recommendedIndustries: [],
      recommendedSeniority: profile.seniorityLevel || "",
      recommendedSearchKeywords: [],
      positioningSummary:
        "Estimated only. We did not find a clear role family on this resume; confirm a target role manually.",
      resumePositioningAdvice: [
        "Add a 1–2 line summary at the top that states the role you're targeting and your most recent measurable wins."
      ],
      skillGaps: [],
      confidence: "low"
    };
  }

  for (let index = 0; index < matched.length; index += 1) {
    const { family, evidence } = matched[index];
    const confidence: ResumeFieldConfidence =
      evidence.length >= 3 ? "high" : evidence.length >= 2 ? "medium" : "low";
    const evidenceLines = evidence.slice(0, 3).map((kw) => `Found "${kw}" in resume`);
    family.industries.forEach((industry) => industries.add(industry));
    family.searchKeywords.forEach((keyword) => searchKeywords.add(keyword));
    family.topSkillGaps.forEach((gap) => skillGaps.push(gap));
    positioningAdvice.push(family.positioningHint);

    // Strong fit requires high-confidence evidence (≥3 family keywords)
    // AND the family must be the primary match. Anything weaker is at
    // most "adjacent". This keeps the deterministic fallback honest:
    // a role labelled "Strong" should mean strong evidence, not just
    // "we matched a family loosely".
    const isPrimary = index === 0;
    const strongFitAllowed = isPrimary && confidence === "high";
    const strongLikeRoles = family.strongRoles.map((title) =>
      buildRecommendedRole(
        title,
        strongFitAllowed ? "strong" : "adjacent",
        evidenceLines,
        family.searchKeywords,
        family.positioningHint,
        strongFitAllowed
          ? `Resume shows clear ${family.name} signal (${evidence.length} keyword${evidence.length === 1 ? "" : "s"}).`
          : `Adjacent ${family.name} role; resume signal partially supports it (${evidence.length} keyword${evidence.length === 1 ? "" : "s"}).`,
        strongFitAllowed ? confidence : confidence === "high" ? "medium" : confidence
      )
    );
    const adjacentRoles = family.adjacentRoles.map((title) =>
      buildRecommendedRole(
        title,
        "adjacent",
        evidenceLines,
        family.searchKeywords,
        family.positioningHint,
        `Adjacent ${family.name} role; resume signal partially supports it.`,
        confidence === "high" ? "medium" : confidence
      )
    );
    const stretchRoles = family.stretchRoles.map((title) =>
      buildRecommendedRole(
        title,
        "stretch",
        evidenceLines,
        family.searchKeywords,
        family.positioningHint,
        `Stretch ${family.name} role; current evidence is below typical hiring bar — apply selectively.`,
        "low"
      )
    );

    if (strongFitAllowed) {
      strongest.push(...strongLikeRoles);
      adjacent.push(...adjacentRoles);
    } else {
      // Weak primary match or non-primary family — every role that would
      // have been "strong" is treated as adjacent so we never overclaim.
      adjacent.push(...strongLikeRoles, ...adjacentRoles);
    }
    stretch.push(...stretchRoles);
  }

  // Defense-in-depth: a title may legitimately appear in multiple
  // families (e.g. "Director of Product"). Dedupe across buckets,
  // keeping the higher-confidence appearance: strong > adjacent >
  // stretch > avoid.
  const seenTitles = new Set<string>();
  function dedupeBucket(roles: RecommendedRole[]): RecommendedRole[] {
    return roles.filter((role) => {
      const key = role.title.trim().toLowerCase();
      if (seenTitles.has(key)) return false;
      seenTitles.add(key);
      return true;
    });
  }
  const dedupedStrongest = dedupeBucket(strongest);
  const dedupedAdjacent = dedupeBucket(adjacent);
  const dedupedStretch = dedupeBucket(stretch);

  // Roles to avoid: surface every other family that did NOT match, with a
  // clear reason. Do not invent — only mark "no evidence" honestly.
  const matchedFamilyNames = new Set(matched.map((entry) => entry.family.name));
  ROLE_FAMILIES.filter((family) => !matchedFamilyNames.has(family.name)).forEach(
    (family) => {
      avoid.push({
        title: `${family.name} roles`,
        fitLevel: "avoid",
        confidence: "medium",
        why: `No ${family.name.toLowerCase()} evidence detected on the resume.`,
        evidenceFromResume: [],
        searchKeywords: family.searchKeywords,
        suggestedResumeAngle:
          "Add quantified examples of this work (or skip this family entirely)."
      });
    }
  );

  const overallConfidence: ResumeFieldConfidence =
    matched[0].evidence.length >= 3
      ? "high"
      : matched[0].evidence.length >= 2
        ? "medium"
        : "low";

  // Dedupe avoid by title (without consuming seenTitles — avoid-only
  // titles can legitimately differ from primary buckets).
  const avoidSeen = new Set<string>();
  const dedupedAvoid = avoid.filter((role) => {
    const key = role.title.trim().toLowerCase();
    if (avoidSeen.has(key)) return false;
    avoidSeen.add(key);
    return true;
  });

  // Dedupe positioning advice — multiple matched families can produce
  // the same hint.
  const dedupedPositioningAdvice = Array.from(new Set(positioningAdvice));

  return {
    strongestRoles: dedupedStrongest,
    adjacentRoles: dedupedAdjacent,
    stretchRoles: dedupedStretch,
    rolesToAvoid: dedupedAvoid,
    recommendedIndustries: Array.from(industries),
    recommendedSeniority: profile.seniorityLevel || "",
    recommendedSearchKeywords: Array.from(searchKeywords),
    positioningSummary: `Estimated only. Strongest fit: ${matched[0].family.name}.`,
    resumePositioningAdvice: dedupedPositioningAdvice,
    skillGaps,
    confidence: overallConfidence
  };
}

class DeterministicResumeIntelligenceAdapter
  implements ResumeIntelligenceAdapter
{
  name = "deterministic-resume-intelligence-adapter";

  async analyze(input: { resume: Resume }): Promise<ResumeIntelligenceAdapterOutput> {
    const text = input.resume.parsedText ?? "";
    const profile: ExtractedResumeProfile = {
      fullName: nameFromText(text),
      email: emailFromText(text),
      phone: phoneFromText(text),
      location: locationFromText(text),
      linkedinUrl: urlFromText(text, "linkedin.com"),
      githubUrl: urlFromText(text, "github.com"),
      portfolioUrl: urlFromText(text, ""),
      currentTitle: detectCurrentTitle(text),
      seniorityLevel: detectSeniority(text),
      yearsOfExperience: yearsExperienceFromText(text),
      industries: detectIndustries(text),
      companies: detectCompanies(text),
      jobTitles: detectJobTitles(text),
      education: detectEducation(text),
      certifications: detectCertifications(text),
      skills: detectSkills(text),
      tools: [],
      projects: projectsFromText(text),
      leadershipExamples: leadershipExamplesFromText(text),
      quantifiedAchievements: quantifiedAchievementsFromText(text),
      workAuthorization: workAuthorizationFromText(text),
      resumeStrengths: [],
      resumeGaps: []
    };
    if (profile.skills.length > 0) {
      profile.resumeStrengths.push(
        `Detected skills: ${profile.skills.slice(0, 5).join(", ")}.`
      );
    }
    if (profile.quantifiedAchievements.length > 0) {
      profile.resumeStrengths.push("Resume includes at least one quantified achievement.");
    } else {
      profile.resumeGaps.push("No quantified achievements detected.");
    }
    if (!profile.currentTitle) {
      profile.resumeGaps.push("Current title is unclear.");
    }

    const confidenceByField = deterministicConfidenceMap(profile);
    const ats = buildAtsRiskAssessment(profile, text);
    const recommendation = buildRoleRecommendations(text, profile);

    return {
      modelName: "deterministic-resume-intelligence-fallback",
      promptVersion: "resume-intelligence-v1",
      extractionMode: "deterministic",
      provider: "deterministic",
      extractedProfile: profile,
      confidenceByField,
      missingFields: ats.missingFields,
      ambiguousFields: ats.ambiguousFields,
      parsingWarnings: ats.parsingWarnings,
      atsRiskScore: ats.atsRiskScore,
      atsRiskLevel: ats.atsRiskLevel,
      suggestedFixes: ats.suggestedFixes,
      recommendation
    };
  }
}

export class PlaceholderLlmResumeIntelligenceAdapter
  implements ResumeIntelligenceAdapter
{
  name = "llm-resume-intelligence-adapter-boundary";
  async analyze(): Promise<never> {
    throw new Error(
      "LLM resume intelligence adapter is not configured in this build."
    );
  }
}

export function createDeterministicResumeIntelligenceAdapter(): ResumeIntelligenceAdapter {
  return new DeterministicResumeIntelligenceAdapter();
}

/**
 * API-backed adapter for the browser. Calls the local AI API server
 * (which is the only thing that holds the OpenAI / Azure OpenAI
 * key) and falls back to running the deterministic adapter in-
 * process when the server is unreachable / errors out / returns a
 * non-2xx response. The browser never sees the upstream API key.
 *
 * The fallback is silent for the user experience but the caller can
 * inspect `output.provider` to know which path actually ran.
 */
export function createApiBackedResumeIntelligenceAdapter(
  apiOptions: ApiClientOptions = {}
): ResumeIntelligenceAdapter {
  const fallback = createDeterministicResumeIntelligenceAdapter();
  return {
    name: "api-backed-resume-intelligence-adapter",
    async analyze(input: { resume: Resume }): Promise<ResumeIntelligenceAdapterOutput> {
      try {
        const response = await callResumeIntelligenceApi(
          {
            resumeId: input.resume.id,
            resumeText: input.resume.parsedText ?? ""
          },
          apiOptions
        );
        // The server already returns a canonical
        // ResumeIntelligenceAdapterOutput shape — pass it through
        // with the provider stamped from the server response so the
        // UI badge reflects the real backend (OpenAI vs Azure
        // OpenAI vs deterministic).
        return { ...response.report, provider: response.provider };
      } catch (error) {
        if (error instanceof ApiResumeIntelligenceUnavailableError) {
          return fallback.analyze(input);
        }
        // Unknown errors still degrade gracefully — never let an
        // analyze call throw out to the caller in the browser.
        return fallback.analyze(input);
      }
    }
  };
}

/**
 * Pick the best resume-intelligence adapter for the current environment.
 *
 * - In the **browser** (window/document defined): use the API-backed
 *   adapter, which calls /api/resume-intelligence and silently falls
 *   back to deterministic if the API is offline. The OpenAI / Azure
 *   OpenAI key never enters the browser bundle.
 * - In **Node** (vitest, scripts) with `OPENAI_API_KEY` set: use the
 *   in-process OpenAI adapter directly so server-side tests can
 *   exercise the real prompt + schema path.
 * - Otherwise (Node without a key): deterministic.
 *
 * Tests can opt into a specific adapter by passing `adapter` to
 * `analyzeResumeIntelligence`.
 */
export function selectResumeIntelligenceAdapter(): ResumeIntelligenceAdapter {
  if (typeof window !== "undefined" && typeof document !== "undefined") {
    return createApiBackedResumeIntelligenceAdapter();
  }
  return (
    pickOpenAIAdapterIfConfigured() ??
    createDeterministicResumeIntelligenceAdapter()
  );
}

function event(
  action: string,
  resourceType: string,
  resourceId: string,
  metadata: AuditMetadata = {}
): ResumeIntelligenceAuditEvent {
  return { action, resourceType, resourceId, metadata };
}

export async function analyzeResumeIntelligence(
  session: AppSession,
  resume: Resume,
  adapter: ResumeIntelligenceAdapter = selectResumeIntelligenceAdapter()
): Promise<AnalyzeResumeResult> {
  const startedAt = nowIso();
  const auditEvents: ResumeIntelligenceAuditEvent[] = [
    event("resume_intelligence_started", "Resume", resume.id, {
      resumeStatus: resume.status,
      adapter: adapter.name
    })
  ];

  let output: ResumeIntelligenceAdapterOutput;
  try {
    output = await adapter.analyze({ resume });
  } catch (error) {
    auditEvents.push(
      event("resume_intelligence_failed", "Resume", resume.id, {
        adapter: adapter.name,
        errorLength: (error instanceof Error ? error.message : "").length
      })
    );
    throw error;
  }

  const reportTimestamp = nowIso();
  const existingReport = getResumeIntelligenceReport(session, resume.id);
  const report = resumeIntelligenceReportSchema.parse({
    id: existingReport?.id ?? createId("ri"),
    tenantId: session.tenant.id,
    userId: session.userId,
    resumeId: resume.id,
    extractionMode: output.extractionMode,
    provider: output.provider,
    modelName: output.modelName,
    promptVersion: output.promptVersion,
    extractedProfile: output.extractedProfile,
    confidenceByField: output.confidenceByField,
    missingFields: output.missingFields,
    ambiguousFields: output.ambiguousFields,
    parsingWarnings: output.parsingWarnings,
    atsRiskScore: output.atsRiskScore,
    atsRiskLevel: output.atsRiskLevel,
    suggestedFixes: output.suggestedFixes,
    createdAt: existingReport?.createdAt ?? reportTimestamp,
    updatedAt: reportTimestamp
  });
  const otherReports = loadResumeIntelligenceReports(session).filter(
    (item) => item.resumeId !== resume.id
  );
  saveResumeIntelligenceReports(session, [report, ...otherReports]);

  const existingRecommendation = getJobTargetRecommendation(session, resume.id);
  const recommendation = jobTargetRecommendationSchema.parse({
    id: existingRecommendation?.id ?? createId("targets"),
    tenantId: session.tenant.id,
    userId: session.userId,
    resumeId: resume.id,
    reportId: report.id,
    strongestRoles: output.recommendation.strongestRoles,
    adjacentRoles: output.recommendation.adjacentRoles,
    stretchRoles: output.recommendation.stretchRoles,
    rolesToAvoid: output.recommendation.rolesToAvoid,
    recommendedIndustries: output.recommendation.recommendedIndustries,
    recommendedSeniority: output.recommendation.recommendedSeniority,
    recommendedSearchKeywords: output.recommendation.recommendedSearchKeywords,
    positioningSummary: output.recommendation.positioningSummary,
    resumePositioningAdvice: output.recommendation.resumePositioningAdvice,
    skillGaps: output.recommendation.skillGaps,
    confidence: output.recommendation.confidence,
    extractionMode: output.extractionMode,
    modelName: output.modelName,
    promptVersion: output.promptVersion,
    createdAt: existingRecommendation?.createdAt ?? reportTimestamp,
    updatedAt: reportTimestamp
  });
  const otherRecommendations = loadJobTargetRecommendations(session).filter(
    (item) => item.resumeId !== resume.id
  );
  saveJobTargetRecommendations(session, [recommendation, ...otherRecommendations]);

  auditEvents.push(
    event("resume_intelligence_completed", "ResumeIntelligenceReport", report.id, {
      resumeId: resume.id,
      extractionMode: output.extractionMode,
      atsRiskLevel: output.atsRiskLevel,
      atsRiskScore: Math.round(output.atsRiskScore),
      missingFieldCount: output.missingFields.length,
      ambiguousFieldCount: output.ambiguousFields.length,
      suggestedFixCount: output.suggestedFixes.length,
      durationMs:
        new Date(reportTimestamp).getTime() - new Date(startedAt).getTime()
    }),
    event(
      "job_target_recommendations_generated",
      "JobTargetRecommendation",
      recommendation.id,
      {
        resumeId: resume.id,
        strongestCount: recommendation.strongestRoles.length,
        adjacentCount: recommendation.adjacentRoles.length,
        stretchCount: recommendation.stretchRoles.length,
        avoidCount: recommendation.rolesToAvoid.length,
        confidence: recommendation.confidence
      }
    )
  );
  output.suggestedFixes.forEach((fix) =>
    auditEvents.push(
      event(
        "resume_fix_suggestion_created",
        "ResumeIntelligenceReport",
        report.id,
        { field: fix.field, severity: fix.severity }
      )
    )
  );

  return { report, recommendation, auditEvents };
}

export interface ConfirmedTargetSelection {
  selectedRoles: string[];
  selectedIndustries: string[];
  recommendedSeniority: string;
}

export function selectionFromRecommendation(
  recommendation: JobTargetRecommendation
): ConfirmedTargetSelection {
  return {
    selectedRoles: [
      ...recommendation.strongestRoles.map((role) => role.title),
      ...recommendation.adjacentRoles.map((role) => role.title)
    ],
    selectedIndustries: recommendation.recommendedIndustries,
    recommendedSeniority: recommendation.recommendedSeniority
  };
}

export function recordRecommendationsConfirmed(
  recommendation: JobTargetRecommendation,
  selection: ConfirmedTargetSelection
): ResumeIntelligenceAuditEvent[] {
  const edited = !arraysEqual(
    selectionFromRecommendation(recommendation).selectedRoles,
    selection.selectedRoles
  );
  const events: ResumeIntelligenceAuditEvent[] = [
    event(
      "job_target_recommendations_confirmed",
      "JobTargetRecommendation",
      recommendation.id,
      {
        resumeId: recommendation.resumeId,
        roleCount: selection.selectedRoles.length,
        industryCount: selection.selectedIndustries.length,
        edited
      }
    )
  ];
  if (edited) {
    events.push(
      event(
        "job_target_recommendations_edited",
        "JobTargetRecommendation",
        recommendation.id,
        {
          resumeId: recommendation.resumeId,
          finalRoleCount: selection.selectedRoles.length
        }
      )
    );
  }
  return events;
}

export function recordResumeProfileConfirmed(
  report: ResumeIntelligenceReport,
  appliedFieldCount: number
): ResumeIntelligenceAuditEvent[] {
  return [
    event(
      "resume_profile_confirmed",
      "ResumeIntelligenceReport",
      report.id,
      {
        resumeId: report.resumeId,
        appliedFieldCount,
        atsRiskLevel: report.atsRiskLevel
      }
    )
  ];
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((item, index) => item === b[index]);
}

export type {
  ExtractedResumeProfile,
  JobTargetRecommendation,
  RecommendedRole,
  ResumeIntelligenceReport
} from "../models/domain";
