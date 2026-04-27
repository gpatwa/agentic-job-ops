import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { currentSession } from "../src/data/currentSession";
import type { Resume } from "../src/models/domain";
import { analyzeResumeIntelligence } from "../src/services/resumeIntelligenceService";
import {
  createDeterministicResumeImprovementAdapter,
  describeBeforeAfter,
  editResumeImprovementDraft,
  generateResumeImprovementDraft,
  getLatestDraftForSourceResume,
  loadResumeImprovementDrafts,
  PlaceholderLlmResumeImprovementAdapter,
  reanalyzeImprovedResume,
  rejectResumeImprovementDraft,
  saveResumeImprovementDraft
} from "../src/services/resumeImprovementService";
import {
  loadResume,
  loadResumeVersions,
  saveResume
} from "../src/services/resumeService";

function installLocalStorageMock() {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, "window", {
    value: {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => store.set(key, value),
        removeItem: (key: string) => store.delete(key),
        clear: () => store.clear()
      }
    },
    configurable: true
  });
}

function makeResume(text: string, id = "resume_test"): Resume {
  const now = new Date().toISOString();
  return {
    id,
    tenantId: currentSession.tenant.id,
    userId: currentSession.userId,
    originalFileName: "resume.txt",
    fileUrl: "local://resume.txt",
    parsedText: text,
    status: "parsed",
    createdAt: now
  };
}

const RICH_RESUME = `Jane Doe
Senior Product Manager
Remote
jane.doe@example.com
+1 555-555-0100
https://www.linkedin.com/in/janedoe

Experience
Senior Product Manager — DemoLabs — 2022 - 2026
Led B2B SaaS workflow automation roadmap; +20% activation, +12% retention.
Skills
Product Management, Roadmap, SQL`;

const PIPED_RESUME = `Jane Doe | Senior PM | jane@example.com | +1 555-555-0100\nLinkedIn | https://www.linkedin.com/in/janedoe\nProduct Management | Roadmap | SQL`;

async function seedAndAnalyze(text: string, id = "resume_test"): Promise<Resume> {
  const resume = saveResume(currentSession, makeResume(text, id));
  await analyzeResumeIntelligence(currentSession, resume);
  return resume;
}

describe("resumeImprovementService", () => {
  beforeEach(() => installLocalStorageMock());
  afterEach(() => Reflect.deleteProperty(globalThis, "window"));

  describe("DeterministicResumeImprovementAdapter", () => {
    it("rebuilds a single-column draft with no pipe characters even when the source has pipes", async () => {
      const resume = await seedAndAnalyze(PIPED_RESUME, "piped");
      const result = await generateResumeImprovementDraft(currentSession, resume.id);
      expect(result.draft.draftMarkdown).not.toContain("|");
      expect(result.draft.generationMode).toBe("deterministic");
    });

    it("includes a Skills section drawn only from skills detected in the source resume", async () => {
      const resume = await seedAndAnalyze(RICH_RESUME, "rich");
      const result = await generateResumeImprovementDraft(currentSession, resume.id);
      const md = result.draft.draftMarkdown;
      expect(md).toMatch(/## Skills/);
      expect(md).toContain("Product Management");
      expect(md).toContain("SQL");
      // Negative: never invent skills that did not appear on the source resume.
      expect(md).not.toMatch(/\b(Java|Kubernetes|Go)\b/);
    });

    it("does not invent an email when the source resume lacks one", async () => {
      const resume = await seedAndAnalyze(
        RICH_RESUME.replace("jane.doe@example.com\n", ""),
        "no-email"
      );
      const result = await generateResumeImprovementDraft(currentSession, resume.id);
      expect(result.draft.draftMarkdown).not.toMatch(
        /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i
      );
      expect(
        result.draft.warningsRemaining.some((w) => w.toLowerCase().includes("email"))
      ).toBe(true);
    });

    it("does not invent metrics when the source has no quantified outcomes", async () => {
      const text = `Jane Doe\nSenior Product Manager\njane@example.com\n+1 555-555-0100\nhttps://www.linkedin.com/in/janedoe\n\nExperience\nSenior Product Manager — DemoLabs — 2022 - 2026\nWorked on roadmap and discovery.\nSkills\nProduct Management`;
      const resume = await seedAndAnalyze(text, "no-metrics");
      const result = await generateResumeImprovementDraft(currentSession, resume.id);
      // Strip placeholder text in [...] before checking for metrics so the
      // helpful "[Add a measurable outcome here…]" reminder doesn't false-trigger.
      const md = result.draft.draftMarkdown.replace(/\[[^\]]+\]/g, "");
      expect(md).not.toMatch(/\d+\s*%/);
      expect(md).not.toMatch(/\$\d+/);
    });

    it("keeps missing-phone in remaining warnings and never fabricates a phone number", async () => {
      const resume = await seedAndAnalyze(
        RICH_RESUME.replace("+1 555-555-0100\n", ""),
        "no-phone"
      );
      const result = await generateResumeImprovementDraft(currentSession, resume.id);
      // Phone is missing on the source so it must NOT be invented and must be
      // surfaced in remaining warnings.
      expect(
        result.draft.warningsRemaining.some((line) => line.startsWith("phone:"))
      ).toBe(true);
      // Defense-in-depth: the draft must not contain a fabricated US-style
      // phone number when the source had none. We use the same heuristic the
      // detector uses (10–15 digits, ignoring year ranges like "2022 - 2026").
      const candidates = result.draft.draftMarkdown.match(/\+?\d[\d\s().-]{6,}\d/g) ?? [];
      const looksLikePhone = candidates.some((candidate) => {
        const trimmed = candidate.trim();
        if (/^\d{4}\s*[-–]\s*\d{4}$/.test(trimmed)) return false;
        const digits = trimmed.replace(/[^0-9]/g, "");
        return digits.length >= 10 && digits.length <= 15;
      });
      expect(looksLikePhone).toBe(false);
    });
  });

  describe("PlaceholderLlmResumeImprovementAdapter", () => {
    it("throws to make the boundary explicit", async () => {
      const adapter = new PlaceholderLlmResumeImprovementAdapter();
      await expect(adapter.improve()).rejects.toThrow();
    });
  });

  describe("workflow", () => {
    it("persists drafts and exposes them via getLatestDraftForSourceResume", async () => {
      const resume = await seedAndAnalyze(RICH_RESUME, "workflow");
      const result = await generateResumeImprovementDraft(currentSession, resume.id);
      expect(result.draft.status).toBe("draft");
      expect(loadResumeImprovementDrafts(currentSession)).toHaveLength(1);
      expect(
        getLatestDraftForSourceResume(currentSession, resume.id)?.id
      ).toBe(result.draft.id);
      expect(result.auditEvents.map((event) => event.action)).toEqual([
        "resume_improvement_generated"
      ]);
    });

    it("editResumeImprovementDraft transitions to 'edited' and stores the new markdown", async () => {
      const resume = await seedAndAnalyze(RICH_RESUME, "edit");
      const created = await generateResumeImprovementDraft(
        currentSession,
        resume.id
      );
      const edited = editResumeImprovementDraft(
        currentSession,
        created.draft.id,
        "Edited markdown content"
      );
      expect(edited.draft.status).toBe("edited");
      expect(edited.draft.draftMarkdown).toBe("Edited markdown content");
      expect(edited.auditEvents[0].action).toBe("resume_improvement_edited");
    });

    it("saveResumeImprovementDraft creates a new resume version while preserving the original", async () => {
      const resume = await seedAndAnalyze(RICH_RESUME, "preserve");
      const draft = await generateResumeImprovementDraft(currentSession, resume.id);
      const saved = saveResumeImprovementDraft(currentSession, draft.draft.id);
      const versions = loadResumeVersions(currentSession);
      expect(versions.some((v) => v.id === resume.id)).toBe(true);
      expect(versions.some((v) => v.id === saved.improvedResume.id)).toBe(true);
      // Active resume now points at the improved copy.
      const active = loadResume(currentSession);
      expect(active?.id).toBe(saved.improvedResume.id);
      expect(saved.draft.status).toBe("saved");
      expect(saved.draft.improvedResumeId).toBe(saved.improvedResume.id);
      expect(saved.auditEvents[0].action).toBe("resume_improvement_saved");
    });

    it("saveResumeImprovementDraft is idempotent for an already-saved draft", async () => {
      const resume = await seedAndAnalyze(RICH_RESUME, "idem");
      const draft = await generateResumeImprovementDraft(currentSession, resume.id);
      const first = saveResumeImprovementDraft(currentSession, draft.draft.id);
      const second = saveResumeImprovementDraft(currentSession, draft.draft.id);
      expect(second.improvedResume.id).toBe(first.improvedResume.id);
      expect(second.auditEvents).toHaveLength(0);
    });

    it("rejectResumeImprovementDraft transitions to 'rejected' and refuses subsequent edits", async () => {
      const resume = await seedAndAnalyze(RICH_RESUME, "reject");
      const draft = await generateResumeImprovementDraft(currentSession, resume.id);
      const rejected = rejectResumeImprovementDraft(currentSession, draft.draft.id);
      expect(rejected.draft.status).toBe("rejected");
      expect(rejected.draft.rejectedAt).not.toBeNull();
      expect(() =>
        editResumeImprovementDraft(currentSession, draft.draft.id, "should fail")
      ).toThrow();
    });

    it("reanalyzeImprovedResume produces a report keyed to the improved resume id and updates the draft", async () => {
      const resume = await seedAndAnalyze(PIPED_RESUME, "reanalyze");
      const draft = await generateResumeImprovementDraft(currentSession, resume.id);
      const saved = saveResumeImprovementDraft(currentSession, draft.draft.id);
      const reanalyzed = await reanalyzeImprovedResume(
        currentSession,
        saved.draft.id
      );
      expect(reanalyzed.improvedReport.resumeId).toBe(saved.improvedResume.id);
      expect(reanalyzed.draft.improvedRiskScore).not.toBeNull();
      expect(reanalyzed.draft.improvedRiskLevel).not.toBeNull();
      expect(
        reanalyzed.draft.improvedRiskScore ?? Number.POSITIVE_INFINITY
      ).toBeLessThanOrEqual(reanalyzed.draft.originalRiskScore);
    });

    it("appends a regression warning when re-analysing the improved draft yields a worse risk", async () => {
      // The original RICH_RESUME has low ATS risk. We replace the draft
      // with a deliberately barren plain-text version, save it, then
      // re-analyse — the improved score should be higher and the
      // service must surface that loudly so the UI never silently
      // promotes a worse resume.
      const resume = await seedAndAnalyze(RICH_RESUME, "regression");
      const draft = await generateResumeImprovementDraft(currentSession, resume.id);
      const worse = editResumeImprovementDraft(
        currentSession,
        draft.draft.id,
        "Jane Doe"
      );
      const saved = saveResumeImprovementDraft(currentSession, worse.draft.id);
      const reanalyzed = await reanalyzeImprovedResume(
        currentSession,
        saved.draft.id
      );
      expect(reanalyzed.draft.improvedRiskScore ?? 0).toBeGreaterThan(
        reanalyzed.draft.originalRiskScore
      );
      expect(reanalyzed.draft.warningsRemaining[0]).toBe(
        "This draft did not improve ATS risk. Review before using."
      );
      // Defense-in-depth: re-analysing twice must not duplicate the warning.
      const reanalyzedAgain = await reanalyzeImprovedResume(
        currentSession,
        saved.draft.id
      );
      const regressionWarnings = reanalyzedAgain.draft.warningsRemaining.filter(
        (line) =>
          line === "This draft did not improve ATS risk. Review before using."
      );
      expect(regressionWarnings).toHaveLength(1);
    });

    it("describeBeforeAfter computes the risk delta after re-analysis", async () => {
      const resume = await seedAndAnalyze(PIPED_RESUME, "delta");
      const draft = await generateResumeImprovementDraft(currentSession, resume.id);
      const saved = saveResumeImprovementDraft(currentSession, draft.draft.id);
      const reanalyzed = await reanalyzeImprovedResume(
        currentSession,
        saved.draft.id
      );
      const summary = describeBeforeAfter(reanalyzed.draft);
      expect(summary.improvedScore).not.toBeNull();
      expect(summary.delta).not.toBeNull();
      expect(summary.originalScore).toBe(reanalyzed.draft.originalRiskScore);
    });

    it("createDeterministicResumeImprovementAdapter returns the deterministic implementation", () => {
      const adapter = createDeterministicResumeImprovementAdapter();
      expect(adapter.name).toBe("deterministic-resume-improvement-adapter");
    });
  });
});
