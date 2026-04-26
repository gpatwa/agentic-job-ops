import type {
  AppSession,
  AtsRiskLevel,
  AuditLog,
  ExtractedResumeProfile,
  Resume,
  ResumeImprovementDraft,
  ResumeImprovementStatus,
  ResumeIntelligenceMode,
  ResumeIntelligenceReport,
  ResumeIntelligenceSuggestedFix
} from "../models/domain";
import { resumeImprovementDraftSchema } from "../models/schemas";
import { readJson, scopedKey, writeJson } from "../lib/storage";
import {
  addResumeVersion,
  createResumeFromText,
  loadResume,
  loadResumeVersions,
  promoteResumeAsActive
} from "./resumeService";
import {
  analyzeResumeIntelligence,
  getResumeIntelligenceReport,
  type ResumeIntelligenceAuditEvent
} from "./resumeIntelligenceService";

type AuditMetadata = AuditLog["metadata"];

/**
 * Phase 17 — Resume improvement loop.
 *
 * - Deterministic-first. The improver never invents experience, skills, or
 *   metrics. It rewrites the resume into a single-column ATS-friendly layout
 *   from the extracted profile + applied fixes only. Everything outside the
 *   evidence stays out.
 * - The original resume is never overwritten. Saving a draft promotes the
 *   improved resume to the active slot but the original is preserved in
 *   version history (loadResumeVersions) under its original id.
 */

export interface ResumeImprovementAuditEvent {
  action: string;
  resourceType: string;
  resourceId: string;
  metadata: AuditMetadata;
}

export interface ResumeImprovementAdapterOutput {
  generationMode: ResumeIntelligenceMode;
  modelName: string;
  promptVersion: string;
  draftMarkdown: string;
  changesSummary: string[];
  appliedFixes: string[];
  warningsRemaining: string[];
}

export interface ResumeImprovementAdapter {
  name: string;
  improve(input: {
    resume: Resume;
    report: ResumeIntelligenceReport;
    targetRoles?: string[];
  }): Promise<ResumeImprovementAdapterOutput>;
}

const DRAFTS_KEY = "resume_improvement_drafts";

function nowIso(): string {
  return new Date().toISOString();
}

function createId(prefix: string): string {
  return `${prefix}_${globalThis.crypto.randomUUID()}`;
}

function draftsKey(session: AppSession): string {
  return scopedKey(session.tenant.id, session.userId, DRAFTS_KEY);
}

export function loadResumeImprovementDrafts(
  session: AppSession
): ResumeImprovementDraft[] {
  const records = readJson<ResumeImprovementDraft[]>(draftsKey(session), []);
  return records.filter(
    (record) => resumeImprovementDraftSchema.safeParse(record).success
  );
}

export function saveResumeImprovementDrafts(
  session: AppSession,
  records: ResumeImprovementDraft[]
): ResumeImprovementDraft[] {
  const parsed = records.map((record) =>
    resumeImprovementDraftSchema.parse(record)
  );
  writeJson(draftsKey(session), parsed.slice(0, 100));
  return parsed;
}

export function getResumeImprovementDraft(
  session: AppSession,
  draftId: string
): ResumeImprovementDraft | null {
  return loadResumeImprovementDrafts(session).find((d) => d.id === draftId) ?? null;
}

export function getLatestDraftForSourceResume(
  session: AppSession,
  sourceResumeId: string
): ResumeImprovementDraft | null {
  return (
    loadResumeImprovementDrafts(session)
      .filter((d) => d.sourceResumeId === sourceResumeId)
      .sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      )[0] ?? null
  );
}

function persistDraft(
  session: AppSession,
  draft: ResumeImprovementDraft
): ResumeImprovementDraft {
  const others = loadResumeImprovementDrafts(session).filter(
    (d) => d.id !== draft.id
  );
  const saved = saveResumeImprovementDrafts(session, [draft, ...others]);
  return saved.find((d) => d.id === draft.id) ?? draft;
}

function event(
  action: string,
  resourceType: string,
  resourceId: string,
  metadata: AuditMetadata = {}
): ResumeImprovementAuditEvent {
  return { action, resourceType, resourceId, metadata };
}

// ---------------------------------------------------------------------------
// Deterministic adapter
// ---------------------------------------------------------------------------

const APPLIED_FIX_FIELDS = new Set([
  "email",
  "phone",
  "location",
  "linkedinUrl",
  "skills",
  "education",
  "currentTitle",
  "recentRoles",
  "layout",
  "length"
]);

function bullet(line: string): string {
  return `- ${line.trim()}`;
}

function buildHeader(profile: ExtractedResumeProfile): string {
  const lines = [profile.fullName || "[Add your full name]"];
  const subtitleParts: string[] = [];
  if (profile.currentTitle) subtitleParts.push(profile.currentTitle);
  else if (profile.jobTitles[0]) subtitleParts.push(profile.jobTitles[0]);
  if (profile.location) subtitleParts.push(profile.location);
  if (subtitleParts.length > 0) {
    lines.push(subtitleParts.join(" — "));
  }
  const contactParts: string[] = [];
  if (profile.email) contactParts.push(profile.email);
  if (profile.phone) contactParts.push(profile.phone);
  if (profile.linkedinUrl) contactParts.push(profile.linkedinUrl);
  if (profile.githubUrl) contactParts.push(profile.githubUrl);
  if (profile.portfolioUrl) contactParts.push(profile.portfolioUrl);
  if (contactParts.length > 0) {
    lines.push(contactParts.join(" · "));
  } else {
    lines.push("[Add an email and phone number]");
  }
  return lines.join("\n");
}

function buildSummary(
  profile: ExtractedResumeProfile,
  targetRoles: string[]
): string {
  if (
    !profile.currentTitle &&
    profile.jobTitles.length === 0 &&
    profile.resumeStrengths.length === 0
  ) {
    return "";
  }
  const role =
    profile.currentTitle ||
    profile.jobTitles[0] ||
    targetRoles[0] ||
    "Senior contributor";
  const yearsClause =
    profile.yearsOfExperience !== null && profile.yearsOfExperience > 0
      ? `${profile.yearsOfExperience}+ years`
      : "Multi-year track record";
  const targetClause =
    targetRoles.length > 0 ? `targeting ${targetRoles.slice(0, 2).join(" / ")}` : "";
  const strengthClause =
    profile.resumeStrengths.length > 0
      ? profile.resumeStrengths.slice(0, 1).join(" ")
      : "";
  const sentence = [
    `${role}.`,
    `${yearsClause} of relevant experience${targetClause ? `, ${targetClause}` : ""}.`,
    strengthClause
  ]
    .filter(Boolean)
    .join(" ")
    .trim();
  return `## Summary\n${sentence}`;
}

function buildExperience(profile: ExtractedResumeProfile): string {
  if (profile.jobTitles.length === 0 && profile.companies.length === 0) {
    return "";
  }
  const lines: string[] = ["## Experience"];
  const titles = profile.jobTitles.length > 0 ? profile.jobTitles : ["[Add your most recent role]"];
  const companies = profile.companies.length > 0 ? profile.companies : ["[Add company name]"];
  titles.forEach((title, index) => {
    const company = companies[index] ?? companies[0] ?? "[Add company name]";
    lines.push(`${title} — ${company}`);
  });
  // Add bullets from leadership + projects + quantified achievements.
  const evidence = [
    ...profile.leadershipExamples,
    ...profile.projects,
    ...profile.quantifiedAchievements
  ];
  // Dedupe so the same bullet isn't repeated when the same line happened to
  // match more than one heuristic.
  const seen = new Set<string>();
  evidence.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || seen.has(trimmed)) return;
    seen.add(trimmed);
    lines.push(bullet(trimmed));
  });
  if (profile.quantifiedAchievements.length === 0) {
    lines.push(
      bullet(
        "[Add a measurable outcome here — e.g., 'shipped X feature, +12% activation'. Do not invent numbers.]"
      )
    );
  }
  return lines.join("\n");
}

function buildSkills(profile: ExtractedResumeProfile): string {
  if (profile.skills.length === 0 && profile.tools.length === 0) return "";
  const merged = Array.from(
    new Set([...profile.skills, ...profile.tools].map((s) => s.trim()).filter(Boolean))
  );
  if (merged.length === 0) return "";
  return `## Skills\n${merged.join(", ")}`;
}

function buildEducation(profile: ExtractedResumeProfile): string {
  if (profile.education.length === 0) return "";
  const lines = ["## Education", ...profile.education.map(bullet)];
  return lines.join("\n");
}

function buildCertifications(profile: ExtractedResumeProfile): string {
  if (profile.certifications.length === 0) return "";
  const lines = ["## Certifications", ...profile.certifications.map(bullet)];
  return lines.join("\n");
}

function buildAuthorization(profile: ExtractedResumeProfile): string {
  if (!profile.workAuthorization) return "";
  return `## Work authorization\n${profile.workAuthorization}`;
}

function detectAppliedAndRemaining(
  fixes: ResumeIntelligenceSuggestedFix[],
  draftMarkdown: string,
  profile: ExtractedResumeProfile
): { appliedFixes: string[]; warningsRemaining: string[] } {
  const applied: string[] = [];
  const remaining: string[] = [];
  const lower = draftMarkdown.toLowerCase();
  fixes.forEach((fix) => {
    const isApplied = (() => {
      switch (fix.field) {
        case "email":
          return Boolean(profile.email);
        case "phone":
          return Boolean(profile.phone);
        case "location":
          return Boolean(profile.location);
        case "linkedinUrl":
          return Boolean(profile.linkedinUrl);
        case "currentTitle":
          return Boolean(profile.currentTitle || profile.jobTitles[0]);
        case "recentRoles":
          return profile.jobTitles.length > 0;
        case "skills":
          return profile.skills.length > 0;
        case "education":
          return profile.education.length > 0;
        case "layout":
          return !lower.includes("|");
        case "length":
          return draftMarkdown.length >= 500;
        default:
          return false;
      }
    })();
    const message = `${fix.field}: ${fix.message}`;
    if (isApplied && APPLIED_FIX_FIELDS.has(fix.field)) {
      applied.push(message);
    } else {
      remaining.push(message);
    }
  });
  return { appliedFixes: applied, warningsRemaining: remaining };
}

class DeterministicResumeImprovementAdapter implements ResumeImprovementAdapter {
  name = "deterministic-resume-improvement-adapter";

  async improve(input: {
    resume: Resume;
    report: ResumeIntelligenceReport;
    targetRoles?: string[];
  }): Promise<ResumeImprovementAdapterOutput> {
    const { report } = input;
    const targetRoles = input.targetRoles ?? [];
    const profile = report.extractedProfile;

    const sections = [
      buildHeader(profile),
      buildSummary(profile, targetRoles),
      buildExperience(profile),
      buildSkills(profile),
      buildEducation(profile),
      buildCertifications(profile),
      buildAuthorization(profile)
    ].filter((section) => section.trim().length > 0);
    // Defense-in-depth: an ATS-friendly draft must never contain pipe
    // characters, since some upstream parsers used them as column
    // separators. We strip them after assembly so any value that leaked
    // through extraction (e.g. a "skills | tools" line that the title
    // detector misclassified) does not end up in the output.
    const draftMarkdown = sections.join("\n\n").replace(/\s*\|\s*/g, " — ");

    const { appliedFixes, warningsRemaining } = detectAppliedAndRemaining(
      report.suggestedFixes,
      draftMarkdown,
      profile
    );

    const changesSummary: string[] = [
      "Rewrote the resume into a single-column, ATS-friendly layout.",
      "Used only verified facts from your existing resume — no metrics or skills were invented.",
      "Added clear section headings (Summary, Experience, Skills, Education) when supporting evidence existed.",
      profile.skills.length > 0
        ? "Consolidated detected skills into a labelled Skills section."
        : "No skills section was added because no skill keywords were detected on the resume.",
      profile.quantifiedAchievements.length === 0
        ? "Added a placeholder reminder to add a quantified outcome — fill it in yourself; never fabricate numbers."
        : "Preserved your existing quantified achievements as bullets."
    ];

    return {
      generationMode: "deterministic",
      modelName: "deterministic-resume-improvement-fallback",
      promptVersion: "resume-improvement-v1",
      draftMarkdown,
      changesSummary,
      appliedFixes,
      warningsRemaining
    };
  }
}

export class PlaceholderLlmResumeImprovementAdapter
  implements ResumeImprovementAdapter
{
  name = "llm-resume-improvement-adapter-boundary";
  async improve(): Promise<never> {
    throw new Error(
      "LLM resume improvement adapter is not configured in this build."
    );
  }
}

export function createDeterministicResumeImprovementAdapter(): ResumeImprovementAdapter {
  return new DeterministicResumeImprovementAdapter();
}

// ---------------------------------------------------------------------------
// Workflow
// ---------------------------------------------------------------------------

export interface GenerateResumeImprovementResult {
  draft: ResumeImprovementDraft;
  auditEvents: ResumeImprovementAuditEvent[];
}

export async function generateResumeImprovementDraft(
  session: AppSession,
  sourceResumeId: string,
  options: {
    targetRoles?: string[];
    adapter?: ResumeImprovementAdapter;
  } = {}
): Promise<GenerateResumeImprovementResult> {
  const sourceResume =
    loadResumeVersions(session).find((r) => r.id === sourceResumeId) ??
    (loadResume(session)?.id === sourceResumeId ? loadResume(session) : null);
  if (!sourceResume) {
    throw new Error("Source resume was not found.");
  }
  const report = getResumeIntelligenceReport(session, sourceResumeId);
  if (!report) {
    throw new Error(
      "Run resume intelligence analysis before generating an improvement draft."
    );
  }
  const adapter = options.adapter ?? createDeterministicResumeImprovementAdapter();
  const output = await adapter.improve({
    resume: sourceResume,
    report,
    targetRoles: options.targetRoles
  });
  const timestamp = nowIso();
  const draft = resumeImprovementDraftSchema.parse({
    id: createId("ri_draft"),
    tenantId: session.tenant.id,
    userId: session.userId,
    sourceResumeId,
    improvedResumeId: null,
    reportId: report.id,
    status: "draft",
    generationMode: output.generationMode,
    modelName: output.modelName,
    promptVersion: output.promptVersion,
    originalRiskLevel: report.atsRiskLevel,
    improvedRiskLevel: null,
    originalRiskScore: report.atsRiskScore,
    improvedRiskScore: null,
    draftMarkdown: output.draftMarkdown,
    changesSummary: output.changesSummary,
    appliedFixes: output.appliedFixes,
    warningsRemaining: output.warningsRemaining,
    createdAt: timestamp,
    updatedAt: timestamp,
    savedAt: null,
    rejectedAt: null
  });
  // Persist as the latest draft for the source resume; replace any prior
  // un-saved draft for the same source so we don't keep stale ones around.
  const others = loadResumeImprovementDrafts(session).filter(
    (d) => !(d.sourceResumeId === sourceResumeId && d.status === "draft")
  );
  saveResumeImprovementDrafts(session, [draft, ...others]);
  return {
    draft,
    auditEvents: [
      event(
        "resume_improvement_generated",
        "ResumeImprovementDraft",
        draft.id,
        {
          sourceResumeId,
          reportId: report.id,
          generationMode: output.generationMode,
          appliedCount: output.appliedFixes.length,
          remainingCount: output.warningsRemaining.length,
          originalRiskLevel: report.atsRiskLevel,
          originalRiskScore: Math.round(report.atsRiskScore)
        }
      )
    ]
  };
}

export interface UpdateResumeImprovementResult {
  draft: ResumeImprovementDraft;
  auditEvents: ResumeImprovementAuditEvent[];
}

export function editResumeImprovementDraft(
  session: AppSession,
  draftId: string,
  draftMarkdown: string
): UpdateResumeImprovementResult {
  const existing = getResumeImprovementDraft(session, draftId);
  if (!existing) throw new Error("Resume improvement draft was not found.");
  if (existing.status === "saved" || existing.status === "rejected") {
    throw new Error(
      `Cannot edit a ${existing.status} draft. Generate a new draft to make changes.`
    );
  }
  const updated = resumeImprovementDraftSchema.parse({
    ...existing,
    status: "edited" as ResumeImprovementStatus,
    draftMarkdown,
    updatedAt: nowIso()
  });
  persistDraft(session, updated);
  return {
    draft: updated,
    auditEvents: [
      event("resume_improvement_edited", "ResumeImprovementDraft", updated.id, {
        markdownLength: draftMarkdown.length
      })
    ]
  };
}

export function rejectResumeImprovementDraft(
  session: AppSession,
  draftId: string
): UpdateResumeImprovementResult {
  const existing = getResumeImprovementDraft(session, draftId);
  if (!existing) throw new Error("Resume improvement draft was not found.");
  if (existing.status === "saved") {
    throw new Error("Cannot reject a saved draft.");
  }
  const timestamp = nowIso();
  const updated = resumeImprovementDraftSchema.parse({
    ...existing,
    status: "rejected" as ResumeImprovementStatus,
    rejectedAt: timestamp,
    updatedAt: timestamp
  });
  persistDraft(session, updated);
  return {
    draft: updated,
    auditEvents: [
      event(
        "resume_improvement_rejected",
        "ResumeImprovementDraft",
        updated.id,
        {}
      )
    ]
  };
}

export interface SaveResumeImprovementResult {
  draft: ResumeImprovementDraft;
  improvedResume: Resume;
  auditEvents: ResumeImprovementAuditEvent[];
}

export function saveResumeImprovementDraft(
  session: AppSession,
  draftId: string
): SaveResumeImprovementResult {
  const existing = getResumeImprovementDraft(session, draftId);
  if (!existing) throw new Error("Resume improvement draft was not found.");
  if (existing.status === "rejected") {
    throw new Error("Cannot save a rejected draft.");
  }
  if (existing.improvedResumeId) {
    const alreadyImproved = loadResumeVersions(session).find(
      (v) => v.id === existing.improvedResumeId
    );
    if (alreadyImproved) {
      // Idempotent: return what we already saved.
      return {
        draft: existing,
        improvedResume: alreadyImproved,
        auditEvents: []
      };
    }
  }
  const improvedResume = createResumeFromText(
    session,
    existing.draftMarkdown,
    "improved-resume.md"
  );
  // Defense-in-depth: make sure the original is in version history before we
  // promote the improved resume.
  const previousActive = loadResume(session);
  if (previousActive) {
    addResumeVersion(session, previousActive);
  }
  promoteResumeAsActive(session, improvedResume);
  const timestamp = nowIso();
  const updated = resumeImprovementDraftSchema.parse({
    ...existing,
    status: "saved" as ResumeImprovementStatus,
    improvedResumeId: improvedResume.id,
    savedAt: timestamp,
    updatedAt: timestamp
  });
  persistDraft(session, updated);
  return {
    draft: updated,
    improvedResume,
    auditEvents: [
      event("resume_improvement_saved", "ResumeImprovementDraft", updated.id, {
        sourceResumeId: existing.sourceResumeId,
        improvedResumeId: improvedResume.id
      })
    ]
  };
}

export interface ReanalyzeResumeImprovementResult {
  draft: ResumeImprovementDraft;
  improvedReport: ResumeIntelligenceReport;
  auditEvents: (ResumeImprovementAuditEvent | ResumeIntelligenceAuditEvent)[];
}

export async function reanalyzeImprovedResume(
  session: AppSession,
  draftId: string
): Promise<ReanalyzeResumeImprovementResult> {
  const existing = getResumeImprovementDraft(session, draftId);
  if (!existing) throw new Error("Resume improvement draft was not found.");
  if (!existing.improvedResumeId) {
    throw new Error("Save the draft as a new resume version before re-analysing.");
  }
  const improvedResume = loadResumeVersions(session).find(
    (v) => v.id === existing.improvedResumeId
  );
  if (!improvedResume) {
    throw new Error("Saved improved resume was not found in version history.");
  }
  const analysis = await analyzeResumeIntelligence(session, improvedResume);
  const timestamp = nowIso();
  const updated = resumeImprovementDraftSchema.parse({
    ...existing,
    improvedRiskLevel: analysis.report.atsRiskLevel,
    improvedRiskScore: analysis.report.atsRiskScore,
    updatedAt: timestamp
  });
  persistDraft(session, updated);
  return {
    draft: updated,
    improvedReport: analysis.report,
    auditEvents: [
      ...analysis.auditEvents,
      event(
        "resume_improvement_reanalyzed",
        "ResumeImprovementDraft",
        updated.id,
        {
          improvedRiskLevel: analysis.report.atsRiskLevel,
          improvedRiskScore: Math.round(analysis.report.atsRiskScore),
          originalRiskLevel: existing.originalRiskLevel,
          originalRiskScore: Math.round(existing.originalRiskScore),
          delta: Math.round(
            existing.originalRiskScore - analysis.report.atsRiskScore
          )
        }
      )
    ]
  };
}

export type ImprovementBeforeAfter = {
  originalLevel: AtsRiskLevel;
  originalScore: number;
  improvedLevel: AtsRiskLevel | null;
  improvedScore: number | null;
  delta: number | null;
};

export function describeBeforeAfter(
  draft: ResumeImprovementDraft
): ImprovementBeforeAfter {
  const delta =
    draft.improvedRiskScore !== null
      ? Math.round(draft.originalRiskScore - draft.improvedRiskScore)
      : null;
  return {
    originalLevel: draft.originalRiskLevel,
    originalScore: draft.originalRiskScore,
    improvedLevel: draft.improvedRiskLevel,
    improvedScore: draft.improvedRiskScore,
    delta
  };
}

export type { ResumeImprovementDraft } from "../models/domain";
