import type {
  AppSession,
  AuditLog,
  CompanyIntelligence,
  IntelligenceConfidence,
  IntelligenceSource,
  JobRiskSeverity,
  JobRiskSignal,
  JobRiskSignalType,
  NormalizedJob,
  RecruiterLead,
  UserProfile
} from "../models/domain";
import {
  companyIntelligenceSchema,
  jobRiskSignalSchema,
  recruiterLeadSchema
} from "../models/schemas";
import { readJson, scopedKey, writeJson } from "../lib/storage";

type AuditMetadata = AuditLog["metadata"];

/**
 * Phase 13 — Company and recruiter intelligence service.
 *
 * - Deterministic-first. Intelligence produced here is best-effort context,
 *   never authoritative truth. UIs must label deterministic output as
 *   "estimated".
 * - Recruiter leads are user-entered or placeholder only. The service never
 *   invents recruiter names; the placeholder name is empty.
 * - Risk signals are heuristic and surface scam/ghost-job indicators so the
 *   user can decide. They never auto-block a manual user action.
 */

export interface IntelligenceAuditEvent {
  action: string;
  resourceType: string;
  resourceId: string;
  metadata: AuditMetadata;
}

export interface IntelligenceForJob {
  intelligence: CompanyIntelligence | null;
  riskSignals: JobRiskSignal[];
  recruiterLeads: RecruiterLead[];
}

export interface GenerateIntelligenceResult {
  intelligence: CompanyIntelligence;
  riskSignals: JobRiskSignal[];
  auditEvents: IntelligenceAuditEvent[];
}

export interface IntelligenceAdapter {
  name: string;
  generate(input: {
    job: NormalizedJob;
    profile: UserProfile | null;
  }): Promise<{
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
    confidence: IntelligenceConfidence;
    source: IntelligenceSource;
  }>;
}

const SUSPICIOUS_TLDS = [
  ".tk",
  ".gq",
  ".ml",
  ".cf",
  ".ga",
  ".top",
  ".click",
  ".country",
  ".loan",
  ".work"
];
const URL_SHORTENERS = [
  "bit.ly",
  "tinyurl.com",
  "ow.ly",
  "is.gd",
  "buff.ly",
  "rebrand.ly",
  "lnkd.in",
  "t.co",
  "goo.gl"
];
const FREE_EMAIL_DOMAINS = [
  "gmail.com",
  "yahoo.com",
  "hotmail.com",
  "outlook.com",
  "aol.com",
  "icloud.com",
  "protonmail.com",
  "live.com"
];
const FEE_REQUEST_PHRASES = [
  "training fee",
  "training deposit",
  "pay to start",
  "pay for materials",
  "buy materials",
  "cover the cost of",
  "send money",
  "purchase equipment",
  "registration fee",
  "background check fee"
];

function nowIso(): string {
  return new Date().toISOString();
}

function createId(prefix: string): string {
  return `${prefix}_${globalThis.crypto.randomUUID()}`;
}

function intelligenceKey(session: AppSession): string {
  return scopedKey(session.tenant.id, session.userId, "company_intelligence");
}

function recruiterLeadsKey(session: AppSession): string {
  return scopedKey(session.tenant.id, session.userId, "recruiter_leads");
}

function riskSignalsKey(session: AppSession): string {
  return scopedKey(session.tenant.id, session.userId, "job_risk_signals");
}

export function loadCompanyIntelligence(
  session: AppSession
): CompanyIntelligence[] {
  const records = readJson<CompanyIntelligence[]>(intelligenceKey(session), []);
  return records.filter(
    (record) => companyIntelligenceSchema.safeParse(record).success
  );
}

export function saveCompanyIntelligence(
  session: AppSession,
  records: CompanyIntelligence[]
): CompanyIntelligence[] {
  const parsed = records.map((record) =>
    companyIntelligenceSchema.parse(record)
  );
  writeJson(intelligenceKey(session), parsed.slice(0, 500));
  return parsed;
}

export function loadRecruiterLeads(session: AppSession): RecruiterLead[] {
  const records = readJson<RecruiterLead[]>(recruiterLeadsKey(session), []);
  return records.filter(
    (record) => recruiterLeadSchema.safeParse(record).success
  );
}

export function saveRecruiterLeads(
  session: AppSession,
  records: RecruiterLead[]
): RecruiterLead[] {
  const parsed = records.map((record) => recruiterLeadSchema.parse(record));
  writeJson(recruiterLeadsKey(session), parsed.slice(0, 500));
  return parsed;
}

export function loadJobRiskSignals(session: AppSession): JobRiskSignal[] {
  const records = readJson<JobRiskSignal[]>(riskSignalsKey(session), []);
  return records.filter(
    (record) => jobRiskSignalSchema.safeParse(record).success
  );
}

export function saveJobRiskSignals(
  session: AppSession,
  records: JobRiskSignal[]
): JobRiskSignal[] {
  const parsed = records.map((record) => jobRiskSignalSchema.parse(record));
  writeJson(riskSignalsKey(session), parsed.slice(0, 1000));
  return parsed;
}

function audit(
  action: string,
  resourceType: string,
  resourceId: string,
  metadata: AuditMetadata = {}
): IntelligenceAuditEvent {
  return { action, resourceType, resourceId, metadata };
}

function safeHostname(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function isUrlShortener(host: string): boolean {
  return URL_SHORTENERS.some((shortener) => host === shortener || host.endsWith("." + shortener));
}

function hasSuspiciousTld(host: string): boolean {
  return SUSPICIOUS_TLDS.some((tld) => host.endsWith(tld));
}

function emailDomainsIn(text: string): string[] {
  const matches = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [];
  return matches.map((m) => m.split("@")[1]?.toLowerCase() ?? "").filter(Boolean);
}

function looksLikeFreeEmail(domain: string): boolean {
  return FREE_EMAIL_DOMAINS.includes(domain);
}

function companyHostnameTokens(company: string): string[] {
  return company
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !["the", "and", "inc", "llc", "ltd", "co", "corp", "company"].includes(token));
}

function detectSuspiciousDomain(job: NormalizedJob): JobRiskSignal | null {
  const host = safeHostname(job.applicationUrl);
  if (!host) return null;
  if (isUrlShortener(host) || hasSuspiciousTld(host)) {
    return signal(
      job,
      "suspicious_domain",
      "high",
      `Application URL hostname (${host}) is a URL shortener or low-trust TLD.`,
      "Verify the posting via the company's official careers page before applying."
    );
  }
  return null;
}

function detectMismatchedAtsDomain(job: NormalizedJob): JobRiskSignal | null {
  const host = safeHostname(job.applicationUrl);
  if (!host) return null;
  // Trusted ATS hosts always pass this check.
  const trustedAts = [
    "greenhouse.io",
    "boards.greenhouse.io",
    "lever.co",
    "jobs.lever.co",
    "ashbyhq.com",
    "workday.com",
    "myworkdayjobs.com",
    "smartrecruiters.com",
    "icims.com",
    "linkedin.com"
  ];
  if (trustedAts.some((trusted) => host === trusted || host.endsWith("." + trusted))) {
    return null;
  }
  const tokens = companyHostnameTokens(job.company);
  if (tokens.length === 0) return null;
  const matches = tokens.some((token) => host.includes(token));
  if (!matches) {
    return signal(
      job,
      "mismatched_ats_domain",
      "medium",
      `Application URL hostname (${host}) does not include the company name (${job.company}) and is not a recognised ATS.`,
      "Confirm the posting links back to the company's official site before applying."
    );
  }
  return null;
}

function detectUnrealisticSalary(job: NormalizedJob): JobRiskSignal | null {
  const max = job.salaryMax ?? job.salaryMin ?? null;
  const min = job.salaryMin ?? null;
  if (max === null) return null;
  if (max > 1_500_000) {
    return signal(
      job,
      "unrealistic_salary",
      "high",
      `Posted maximum salary ($${max.toLocaleString()}) is unusually high for this title.`,
      "Verify the compensation details with the recruiter before submitting an application."
    );
  }
  if (min !== null && min > 0 && min < 15000) {
    return signal(
      job,
      "unrealistic_salary",
      "medium",
      `Posted minimum salary ($${min.toLocaleString()}) is unusually low.`,
      "Confirm whether this is annual salary or a different unit."
    );
  }
  return null;
}

function detectVagueDescription(job: NormalizedJob): JobRiskSignal | null {
  const wordCount = job.description.trim().split(/\s+/).filter(Boolean).length;
  const noResponsibilities = job.responsibilities.length === 0;
  const noRequirements = job.requirements.length === 0;
  if (wordCount < 60 && (noResponsibilities || noRequirements)) {
    return signal(
      job,
      "vague_description",
      "medium",
      `Job description is short (${wordCount} words) and is missing ${
        noResponsibilities ? "responsibilities" : "requirements"
      }.`,
      "Ask the recruiter or hiring manager for a fuller scope before investing in an application."
    );
  }
  return null;
}

function detectFeeRequest(job: NormalizedJob): JobRiskSignal | null {
  const text = job.description.toLowerCase();
  const matched = FEE_REQUEST_PHRASES.find((phrase) => text.includes(phrase));
  if (matched) {
    return signal(
      job,
      "fee_request",
      "high",
      `Job description contains a payment-from-applicant phrase ("${matched}").`,
      "Reputable employers do not ask candidates to pay. Treat as scam unless verified."
    );
  }
  return null;
}

function detectNonCompanyEmail(job: NormalizedJob): JobRiskSignal | null {
  const domains = emailDomainsIn(job.description);
  if (domains.length === 0) return null;
  const freeDomains = domains.filter(looksLikeFreeEmail);
  if (freeDomains.length === 0) return null;
  return signal(
    job,
    "non_company_email",
    "high",
    `Job description includes a free-email contact (${freeDomains[0]}). Legitimate employers usually use a company-domain email.`,
    "Verify the contact through the company's official careers page before responding."
  );
}

function detectStaleOrReposted(job: NormalizedJob): JobRiskSignal | null {
  if (!job.postedAt) return null;
  const postedTime = new Date(job.postedAt).getTime();
  if (Number.isNaN(postedTime)) return null;
  const ageDays = (Date.now() - postedTime) / (1000 * 60 * 60 * 24);
  if (ageDays > 90) {
    return signal(
      job,
      "stale_or_reposted",
      "low",
      `Posting is ${Math.round(ageDays)} days old. It may be stale or repeatedly reposted.`,
      "Check the company careers page for an updated posting before applying."
    );
  }
  return null;
}

function signal(
  job: NormalizedJob,
  riskType: JobRiskSignalType,
  severity: JobRiskSeverity,
  explanation: string,
  recommendedAction: string
): JobRiskSignal {
  return jobRiskSignalSchema.parse({
    id: createId("risk"),
    tenantId: job.tenantId,
    userId: job.userId,
    jobId: job.id,
    riskType,
    severity,
    explanation,
    recommendedAction,
    createdAt: nowIso()
  });
}

export function detectJobRiskSignals(job: NormalizedJob): JobRiskSignal[] {
  const detectors = [
    detectFeeRequest, // run high-severity detectors first for clarity
    detectNonCompanyEmail,
    detectSuspiciousDomain,
    detectUnrealisticSalary,
    detectMismatchedAtsDomain,
    detectVagueDescription,
    detectStaleOrReposted
  ];
  const signals: JobRiskSignal[] = [];
  for (const detector of detectors) {
    const result = detector(job);
    if (result) signals.push(result);
  }
  return signals;
}

function detectBusinessModel(description: string): string {
  const lower = description.toLowerCase();
  if (lower.includes("b2b") && lower.includes("saas")) return "B2B SaaS";
  if (lower.includes("marketplace")) return "Marketplace";
  if (lower.includes("consumer") || lower.includes("b2c")) return "Consumer";
  if (lower.includes("infrastructure") || lower.includes("developer tools"))
    return "Developer infrastructure";
  if (lower.includes("fintech") || lower.includes("payments")) return "Fintech";
  if (lower.includes("healthcare") || lower.includes("biotech")) return "Healthcare";
  return "Unspecified";
}

function detectFundingStage(description: string): string {
  const lower = description.toLowerCase();
  const stageMatch = lower.match(/series ([a-d])/);
  if (stageMatch) return `Series ${stageMatch[1].toUpperCase()}`;
  if (lower.includes("seed")) return "Seed";
  if (lower.includes("public") || lower.includes("publicly traded")) return "Public";
  if (lower.includes("bootstrapped")) return "Bootstrapped";
  return "Unspecified";
}

function detectCompanySize(description: string): string {
  const lower = description.toLowerCase();
  if (lower.includes("fortune 500") || lower.includes("global enterprise"))
    return "Enterprise";
  if (lower.includes("scale-up") || lower.includes("growth stage"))
    return "Scale-up";
  if (lower.includes("early stage") || lower.includes("seed-stage"))
    return "Early stage";
  if (lower.includes("startup")) return "Startup";
  return "Unspecified";
}

function buildWhyThisCompany(
  job: NormalizedJob,
  profile: UserProfile | null
): string {
  if (!profile) {
    return `Estimated fit. Add a profile to get a personalised view of why ${job.company} may be a good match.`;
  }
  const matches: string[] = [];
  const profileTitles = profile.targetTitles.map((title) => title.toLowerCase());
  if (profileTitles.some((title) => job.title.toLowerCase().includes(title))) {
    matches.push(`role title aligns with your target (${profile.targetTitles.join(", ")})`);
  }
  if (profile.targetIndustries.length > 0) {
    const industryMatch = profile.targetIndustries.find((industry) =>
      job.description.toLowerCase().includes(industry.toLowerCase())
    );
    if (industryMatch) {
      matches.push(`industry overlap with ${industryMatch}`);
    }
  }
  if (profile.companiesToPrioritize.some((c) => c.toLowerCase() === job.company.toLowerCase())) {
    matches.push("on your prioritised companies list");
  }
  if (matches.length === 0) {
    return `Estimated fit only. The deterministic generator did not find an obvious overlap between ${job.company} and your saved targets.`;
  }
  return `Estimated reasons: ${matches.join("; ")}.`;
}

function buildInterviewPrepNotes(job: NormalizedJob): string[] {
  const notes: string[] = [];
  if (job.requirements.length > 0) {
    notes.push(
      `Be ready to discuss specific examples for: ${job.requirements
        .slice(0, 3)
        .join(", ")}.`
    );
  }
  if (job.responsibilities.length > 0) {
    notes.push(
      `Prepare a story for each responsibility: ${job.responsibilities
        .slice(0, 3)
        .join(", ")}.`
    );
  }
  notes.push(
    `Read ${job.company}'s public posts for the last 60 days and prepare two thoughtful questions.`
  );
  return notes;
}

function buildCompensationSignals(job: NormalizedJob): string {
  if (job.salaryMin === null && job.salaryMax === null) {
    return "No salary band is published. Ask early for the range to avoid mismatches.";
  }
  const min = job.salaryMin ? `$${job.salaryMin.toLocaleString()}` : "?";
  const max = job.salaryMax ? `$${job.salaryMax.toLocaleString()}` : "?";
  return `Posted band: ${min} – ${max}. Treat as the publicly stated range; final offers vary.`;
}

function buildReferralStrategy(job: NormalizedJob): string {
  return `Search your network for current ${job.company} employees with overlapping background; a warm intro typically beats a cold application. The extension never harvests private LinkedIn data on your behalf.`;
}

class DeterministicIntelligenceAdapter implements IntelligenceAdapter {
  name = "deterministic-intelligence-adapter";
  async generate(input: {
    job: NormalizedJob;
    profile: UserProfile | null;
  }): Promise<{
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
    confidence: IntelligenceConfidence;
    source: IntelligenceSource;
  }> {
    const { job, profile } = input;
    const summary = `${job.company} is hiring for ${job.title}. Estimated context generated from the public posting; verify before relying on it.`;
    return {
      summary,
      businessModel: detectBusinessModel(job.description),
      industry:
        profile?.targetIndustries.find((i) =>
          job.description.toLowerCase().includes(i.toLowerCase())
        ) ?? "Unspecified",
      companySize: detectCompanySize(job.description),
      fundingStage: detectFundingStage(job.description),
      recentSignals: [],
      whyThisCompany: buildWhyThisCompany(job, profile),
      interviewPrepNotes: buildInterviewPrepNotes(job),
      compensationSignals: buildCompensationSignals(job),
      referralStrategy: buildReferralStrategy(job),
      confidence: "low",
      source: "deterministic"
    };
  }
}

export class PlaceholderLlmIntelligenceAdapter implements IntelligenceAdapter {
  name = "llm-intelligence-adapter-boundary";
  async generate(): Promise<never> {
    throw new Error("LLM intelligence adapter is not configured in this build.");
  }
}

export function createDeterministicIntelligenceAdapter(): IntelligenceAdapter {
  return new DeterministicIntelligenceAdapter();
}

export async function generateCompanyIntelligence(
  session: AppSession,
  job: NormalizedJob,
  profile: UserProfile | null,
  adapter: IntelligenceAdapter = createDeterministicIntelligenceAdapter()
): Promise<GenerateIntelligenceResult> {
  const generated = await adapter.generate({ job, profile });
  const existing = loadCompanyIntelligence(session).find(
    (record) => record.jobId === job.id
  );
  const timestamp = nowIso();
  const intelligence = companyIntelligenceSchema.parse({
    id: existing?.id ?? createId("intel"),
    tenantId: session.tenant.id,
    userId: session.userId,
    jobId: job.id,
    company: job.company,
    summary: generated.summary,
    businessModel: generated.businessModel,
    industry: generated.industry,
    companySize: generated.companySize,
    fundingStage: generated.fundingStage,
    recentSignals: generated.recentSignals,
    whyThisCompany: generated.whyThisCompany,
    interviewPrepNotes: generated.interviewPrepNotes,
    compensationSignals: generated.compensationSignals,
    referralStrategy: generated.referralStrategy,
    source: generated.source,
    confidence: generated.confidence,
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp
  });

  // Replace any existing record for this job.
  const existingRecords = loadCompanyIntelligence(session).filter(
    (record) => record.jobId !== job.id
  );
  saveCompanyIntelligence(session, [intelligence, ...existingRecords]);

  // Replace any existing risk signals for this job, then re-detect.
  const otherRiskSignals = loadJobRiskSignals(session).filter(
    (signal) => signal.jobId !== job.id
  );
  const riskSignals = detectJobRiskSignals(job);
  saveJobRiskSignals(session, [...riskSignals, ...otherRiskSignals]);

  const auditEvents: IntelligenceAuditEvent[] = [
    audit(
      existing
        ? "company_intelligence_refreshed"
        : "company_intelligence_generated",
      "CompanyIntelligence",
      intelligence.id,
      {
        jobId: job.id,
        company: job.company,
        source: intelligence.source,
        confidence: intelligence.confidence,
        riskSignalCount: riskSignals.length
      }
    )
  ];
  riskSignals.forEach((signal) =>
    auditEvents.push(
      audit("job_risk_signal_created", "JobRiskSignal", signal.id, {
        jobId: signal.jobId,
        riskType: signal.riskType,
        severity: signal.severity
      })
    )
  );

  return { intelligence, riskSignals, auditEvents };
}

export interface AddRecruiterLeadInput {
  jobId: string;
  company: string;
  name: string;
  title?: string;
  publicProfileUrl?: string;
  outreachSuggestion?: string;
  source?: IntelligenceSource;
}

export interface AddRecruiterLeadResult {
  lead: RecruiterLead;
  leads: RecruiterLead[];
  auditEvents: IntelligenceAuditEvent[];
}

export function addRecruiterLead(
  session: AppSession,
  input: AddRecruiterLeadInput
): AddRecruiterLeadResult {
  // Defense-in-depth: never invent a recruiter name. Caller must provide one
  // (manual entry) or pass an empty string for a placeholder lead.
  const lead = recruiterLeadSchema.parse({
    id: createId("lead"),
    tenantId: session.tenant.id,
    userId: session.userId,
    jobId: input.jobId,
    company: input.company,
    name: input.name ?? "",
    title: input.title ?? "",
    publicProfileUrl: input.publicProfileUrl ?? "",
    source: input.source ?? "manual",
    confidence: "low",
    outreachSuggestion:
      input.outreachSuggestion ??
      "Send a short, role-specific message that references one detail from the job description.",
    createdAt: nowIso()
  });
  const leads = saveRecruiterLeads(session, [lead, ...loadRecruiterLeads(session)]);
  return {
    lead,
    leads,
    auditEvents: [
      audit("recruiter_lead_added", "RecruiterLead", lead.id, {
        jobId: lead.jobId,
        company: lead.company,
        source: lead.source
      })
    ]
  };
}

export function intelligenceForJob(
  session: AppSession,
  jobId: string
): IntelligenceForJob {
  const intelligence =
    loadCompanyIntelligence(session).find(
      (record) => record.jobId === jobId
    ) ?? null;
  const riskSignals = loadJobRiskSignals(session).filter(
    (signal) => signal.jobId === jobId
  );
  const recruiterLeads = loadRecruiterLeads(session).filter(
    (lead) => lead.jobId === jobId
  );
  return { intelligence, riskSignals, recruiterLeads };
}

export function highestRiskSeverity(
  signals: JobRiskSignal[]
): JobRiskSeverity | null {
  if (signals.some((signal) => signal.severity === "high")) return "high";
  if (signals.some((signal) => signal.severity === "medium")) return "medium";
  if (signals.length > 0) return "low";
  return null;
}

export function jobHasHighRiskSignal(signals: JobRiskSignal[]): boolean {
  return signals.some((signal) => signal.severity === "high");
}

export type { CompanyIntelligence, JobRiskSignal, RecruiterLead } from "../models/domain";
