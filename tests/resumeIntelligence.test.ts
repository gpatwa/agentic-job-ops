import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { currentSession } from "../src/data/currentSession";
import type { Resume } from "../src/models/domain";
import {
  analyzeResumeIntelligence,
  createDeterministicResumeIntelligenceAdapter,
  getJobTargetRecommendation,
  getResumeIntelligenceReport,
  loadJobTargetRecommendations,
  loadResumeIntelligenceReports,
  PlaceholderLlmResumeIntelligenceAdapter,
  recordRecommendationsConfirmed,
  recordResumeProfileConfirmed,
  selectionFromRecommendation
} from "../src/services/resumeIntelligenceService";

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

const PRODUCT_RESUME = `Jane Doe
Senior Product Manager
Remote
jane.doe@example.com
+1 555-555-0100
https://www.linkedin.com/in/janedoe
https://github.com/janedoe

Experience
Senior Product Manager — DemoLabs — 2022 - 2026
Led B2B SaaS workflow automation roadmap; partnered with engineering and design.
Shipped major roadmap; +20% activation, +12% retention.
Customer discovery interviews; led cross-functional team of 4 engineers.

Skills
Product Management, Roadmap, Customer Discovery, SQL, Figma`;

describe("resumeIntelligenceService", () => {
  beforeEach(() => installLocalStorageMock());
  afterEach(() => Reflect.deleteProperty(globalThis, "window"));

  describe("DeterministicResumeIntelligenceAdapter", () => {
    it("extracts high-confidence contact fields and skills from a clean resume", async () => {
      const adapter = createDeterministicResumeIntelligenceAdapter();
      const output = await adapter.analyze({ resume: makeResume(PRODUCT_RESUME) });
      expect(output.extractionMode).toBe("deterministic");
      expect(output.extractedProfile.fullName).toBe("Jane Doe");
      expect(output.extractedProfile.email).toBe("jane.doe@example.com");
      expect(output.extractedProfile.linkedinUrl).toContain("linkedin.com/in/janedoe");
      expect(output.extractedProfile.skills.length).toBeGreaterThan(0);
      expect(output.confidenceByField.fullName).toBe("high");
      expect(output.confidenceByField.email).toBe("high");
      expect(output.confidenceByField.linkedinUrl).toBe("high");
      expect(output.atsRiskLevel).toBe("low");
    });

    it("never invents skills when no recognised keywords are present", async () => {
      const adapter = createDeterministicResumeIntelligenceAdapter();
      const text = `Jane Doe\nNo recognisable role keywords here.\njane.doe@example.com\n+1 555-555-0100`;
      const output = await adapter.analyze({ resume: makeResume(text) });
      expect(output.extractedProfile.skills).toEqual([]);
    });

    it("flags missing email and missing phone with appropriate severities", async () => {
      const adapter = createDeterministicResumeIntelligenceAdapter();
      const noEmail = await adapter.analyze({
        resume: makeResume(PRODUCT_RESUME.replace("jane.doe@example.com\n", ""))
      });
      expect(noEmail.missingFields).toContain("email");
      expect(
        noEmail.suggestedFixes.find((fix) => fix.field === "email")?.severity
      ).toBe("high");

      const noPhone = await adapter.analyze({
        resume: makeResume(PRODUCT_RESUME.replace("+1 555-555-0100\n", ""))
      });
      expect(noPhone.missingFields).toContain("phone");
      expect(
        noPhone.suggestedFixes.find((fix) => fix.field === "phone")?.severity
      ).toBe("medium");
    });

    it("flags table/column layouts as ATS warnings", async () => {
      const adapter = createDeterministicResumeIntelligenceAdapter();
      const text = `Jane Doe | Senior PM | jane@example.com | +1 555-555-0100`;
      const output = await adapter.analyze({ resume: makeResume(text) });
      expect(
        output.parsingWarnings.some((warning) =>
          warning.toLowerCase().includes("multi-column")
        )
      ).toBe(true);
    });

    it("flags ambiguous dates", async () => {
      const adapter = createDeterministicResumeIntelligenceAdapter();
      const output = await adapter.analyze({
        resume: makeResume(
          PRODUCT_RESUME.replace("2022 - 2026", "recently and currently")
        )
      });
      expect(output.ambiguousFields).toContain("dates");
    });

    it("flags resumes without quantified outcomes", async () => {
      const adapter = createDeterministicResumeIntelligenceAdapter();
      const text = `Jane Doe\nSenior Product Manager\njane@example.com\n+1 555-555-0100\n\nExperience\nSenior PM — DemoLabs\nLed roadmap and discovery.`;
      const output = await adapter.analyze({ resume: makeResume(text) });
      expect(
        output.suggestedFixes.some(
          (fix) => fix.field === "quantifiedAchievements"
        )
      ).toBe(true);
    });

    it("recommends product roles for a product resume and never strong-fits without evidence", async () => {
      const adapter = createDeterministicResumeIntelligenceAdapter();
      const product = await adapter.analyze({ resume: makeResume(PRODUCT_RESUME) });
      const productTitles = product.recommendation.strongestRoles.map((role) =>
        role.title.toLowerCase()
      );
      expect(productTitles.some((title) => title.includes("product"))).toBe(true);

      const empty = await adapter.analyze({
        resume: makeResume(`No keywords here.\njane@example.com`)
      });
      expect(empty.recommendation.strongestRoles).toEqual([]);
    });

    it("labels stretch roles clearly with low confidence", async () => {
      const adapter = createDeterministicResumeIntelligenceAdapter();
      const output = await adapter.analyze({ resume: makeResume(PRODUCT_RESUME) });
      output.recommendation.stretchRoles.forEach((role) => {
        expect(role.fitLevel).toBe("stretch");
        expect(role.confidence).toBe("low");
      });
    });

    it("includes an explanation for every role to avoid", async () => {
      const adapter = createDeterministicResumeIntelligenceAdapter();
      const output = await adapter.analyze({ resume: makeResume(PRODUCT_RESUME) });
      expect(output.recommendation.rolesToAvoid.length).toBeGreaterThan(0);
      output.recommendation.rolesToAvoid.forEach((role) => {
        expect(role.fitLevel).toBe("avoid");
        expect(role.why.trim().length).toBeGreaterThan(0);
      });
    });

    it("recommends data roles for a data resume and AI roles for an AI resume", async () => {
      const adapter = createDeterministicResumeIntelligenceAdapter();
      const dataText = `Jane Doe
Senior Data Engineer
Remote
jane@example.com
+1 555-555-0100
https://www.linkedin.com/in/janedoe

Experience
Senior Data Engineer — DemoData — 2022 - 2026
Built data pipelines and warehouse ETL with Snowflake.
Skills
SQL, Pipelines, Snowflake`;
      const data = await adapter.analyze({ resume: makeResume(dataText) });
      expect(
        data.recommendation.strongestRoles.some((role) =>
          role.title.toLowerCase().includes("data")
        )
      ).toBe(true);

      const aiText = `Jane Doe
AI Engineer
Remote
jane@example.com
+1 555-555-0100
https://www.linkedin.com/in/janedoe

Experience
AI Engineer — DemoAI — 2022 - 2026
Shipped LLM agents and RAG systems with model evals.
Skills
LLM, RAG, Agents, Model Evals`;
      const ai = await adapter.analyze({ resume: makeResume(aiText) });
      expect(
        ai.recommendation.strongestRoles.some((role) =>
          role.title.toLowerCase().includes("ai")
        )
      ).toBe(true);
    });
  });

  describe("PlaceholderLlmResumeIntelligenceAdapter", () => {
    it("throws to make the boundary explicit", async () => {
      const adapter = new PlaceholderLlmResumeIntelligenceAdapter();
      await expect(adapter.analyze()).rejects.toThrow();
    });
  });

  describe("analyzeResumeIntelligence (persistence + audit)", () => {
    it("persists a report + recommendation and emits the documented audit events", async () => {
      const result = await analyzeResumeIntelligence(
        currentSession,
        makeResume(PRODUCT_RESUME)
      );
      expect(loadResumeIntelligenceReports(currentSession)).toHaveLength(1);
      expect(loadJobTargetRecommendations(currentSession)).toHaveLength(1);

      const actions = result.auditEvents.map((event) => event.action);
      expect(actions).toContain("resume_intelligence_started");
      expect(actions).toContain("resume_intelligence_completed");
      expect(actions).toContain("job_target_recommendations_generated");
      expect(
        actions.filter((action) => action === "resume_fix_suggestion_created")
          .length
      ).toBe(result.report.suggestedFixes.length);
    });

    it("replaces (not duplicates) the report and recommendation when re-analyzed", async () => {
      const resume = makeResume(PRODUCT_RESUME);
      await analyzeResumeIntelligence(currentSession, resume);
      await analyzeResumeIntelligence(currentSession, resume);
      expect(loadResumeIntelligenceReports(currentSession)).toHaveLength(1);
      expect(loadJobTargetRecommendations(currentSession)).toHaveLength(1);
      const report = getResumeIntelligenceReport(currentSession, resume.id);
      const recommendation = getJobTargetRecommendation(
        currentSession,
        resume.id
      );
      expect(report?.resumeId).toBe(resume.id);
      expect(recommendation?.resumeId).toBe(resume.id);
    });
  });

  describe("selectionFromRecommendation + confirmation audit helpers", () => {
    it("seeds the confirmation selection with strongest+adjacent role titles", async () => {
      const result = await analyzeResumeIntelligence(
        currentSession,
        makeResume(PRODUCT_RESUME)
      );
      const selection = selectionFromRecommendation(result.recommendation);
      expect(selection.selectedRoles[0]).toBe(
        result.recommendation.strongestRoles[0].title
      );
      expect(selection.selectedRoles).toEqual(
        expect.arrayContaining(
          result.recommendation.adjacentRoles.map((role) => role.title)
        )
      );
    });

    it("recordRecommendationsConfirmed emits an edited audit when the selection differs", async () => {
      const result = await analyzeResumeIntelligence(
        currentSession,
        makeResume(PRODUCT_RESUME)
      );
      const baseline = selectionFromRecommendation(result.recommendation);
      const sameAudits = recordRecommendationsConfirmed(
        result.recommendation,
        baseline
      );
      expect(sameAudits.map((event) => event.action)).toEqual([
        "job_target_recommendations_confirmed"
      ]);

      const editedAudits = recordRecommendationsConfirmed(
        result.recommendation,
        {
          ...baseline,
          selectedRoles: ["Custom Role Only"]
        }
      );
      expect(editedAudits.map((event) => event.action)).toContain(
        "job_target_recommendations_edited"
      );
    });

    it("recordResumeProfileConfirmed emits the confirmation audit with applied count", async () => {
      const result = await analyzeResumeIntelligence(
        currentSession,
        makeResume(PRODUCT_RESUME)
      );
      const events = recordResumeProfileConfirmed(result.report, 4);
      expect(events).toHaveLength(1);
      expect(events[0].action).toBe("resume_profile_confirmed");
      expect(events[0].metadata.appliedFieldCount).toBe(4);
    });
  });
});
