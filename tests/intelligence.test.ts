import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { currentSession } from "../src/data/currentSession";
import type { NormalizedJob, UserProfile } from "../src/models/domain";
import {
  addRecruiterLead,
  detectJobRiskSignals,
  generateCompanyIntelligence,
  highestRiskSeverity,
  intelligenceForJob,
  jobHasHighRiskSignal,
  loadCompanyIntelligence,
  loadJobRiskSignals,
  loadRecruiterLeads
} from "../src/services/intelligenceService";
import { userProfileSchema } from "../src/models/schemas";
import { saveNormalizedJobs } from "../src/services/jobIngestion";
import { runCareerOps, saveCareerOpsSettings } from "../src/services/careerOpsService";
import { loadApplicationPackages } from "../src/services/applicationPackage";
import { scopedKey } from "../src/lib/storage";

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

function profile(overrides: Partial<UserProfile> = {}): UserProfile {
  const timestamp = new Date().toISOString();
  return userProfileSchema.parse({
    id: "profile_test",
    tenantId: currentSession.tenant.id,
    userId: currentSession.userId,
    fullName: "Example User",
    email: "example@example.com",
    phone: "555-0100",
    location: "Remote",
    workAuthorization: "Authorized to work in the United States",
    linkedinUrl: "https://www.linkedin.com/in/example",
    portfolioUrl: "https://example.com",
    githubUrl: "https://github.com/example",
    targetTitles: ["Staff Product Manager"],
    targetLocations: ["Remote"],
    targetIndustries: ["B2B SaaS", "Workflow Automation"],
    remotePreference: "remote",
    salaryMin: 150000,
    salaryTarget: 180000,
    companiesToAvoid: [],
    companiesToPrioritize: ["ExampleCo"],
    careerSummary: "Product leader.",
    verifiedFacts: ["Led B2B SaaS launches"],
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides
  });
}

function job(overrides: Partial<NormalizedJob> = {}): NormalizedJob {
  const now = new Date().toISOString();
  return {
    id: "job_test",
    tenantId: currentSession.tenant.id,
    userId: currentSession.userId,
    sourceConfigId: null,
    source: "greenhouse",
    sourceJobId: "test_1",
    title: "Staff Product Manager",
    company: "ExampleCo",
    location: "Remote",
    remoteType: "remote",
    salaryMin: 170000,
    salaryMax: 210000,
    description:
      "ExampleCo is hiring a Staff Product Manager for B2B SaaS workflow automation, customer discovery, roadmap delivery, and cross-functional execution with engineering and design partners.",
    responsibilities: ["Lead customer discovery", "Partner with engineering"],
    requirements: ["B2B SaaS PM experience", "Workflow automation experience"],
    applicationUrl: "https://boards.greenhouse.io/example/jobs/123",
    atsType: "greenhouse",
    postedAt: now,
    discoveredAt: now,
    scoringStatus: "queued",
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

function seedProfileForCurrentSession(overrides: Partial<UserProfile> = {}) {
  window.localStorage.setItem(
    scopedKey(currentSession.tenant.id, currentSession.userId, "profile"),
    JSON.stringify(profile(overrides))
  );
}

describe("intelligenceService", () => {
  beforeEach(() => installLocalStorageMock());
  afterEach(() => Reflect.deleteProperty(globalThis, "window"));

  describe("detectJobRiskSignals", () => {
    it("flags URL-shortener applicationUrls as suspicious_domain (high)", () => {
      const signals = detectJobRiskSignals(
        job({ applicationUrl: "https://bit.ly/abc123def" })
      );
      const suspicious = signals.find((s) => s.riskType === "suspicious_domain");
      expect(suspicious?.severity).toBe("high");
    });

    it("flags low-trust TLD applicationUrls as suspicious_domain (high)", () => {
      const signals = detectJobRiskSignals(
        job({ applicationUrl: "https://example.tk/jobs/123" })
      );
      const suspicious = signals.find((s) => s.riskType === "suspicious_domain");
      expect(suspicious?.severity).toBe("high");
    });

    it("flags fee-request language as fee_request (high)", () => {
      const signals = detectJobRiskSignals(
        job({
          description:
            "Send your resume and a $250 training fee to start onboarding."
        })
      );
      const fee = signals.find((s) => s.riskType === "fee_request");
      expect(fee?.severity).toBe("high");
    });

    it("flags free-email contact as non_company_email (high)", () => {
      const signals = detectJobRiskSignals(
        job({
          description:
            "Apply by sending your resume to recruiter@gmail.com today."
        })
      );
      const email = signals.find((s) => s.riskType === "non_company_email");
      expect(email?.severity).toBe("high");
    });

    it("flags very short, requirement-less descriptions as vague_description (medium)", () => {
      const signals = detectJobRiskSignals(
        job({
          description: "Hiring now. Apply.",
          responsibilities: [],
          requirements: []
        })
      );
      const vague = signals.find((s) => s.riskType === "vague_description");
      expect(vague?.severity).toBe("medium");
    });

    it("flags unrealistic salary maxima (high)", () => {
      const signals = detectJobRiskSignals(
        job({ salaryMax: 5_000_000 })
      );
      const salary = signals.find((s) => s.riskType === "unrealistic_salary");
      expect(salary?.severity).toBe("high");
    });

    it("flags stale postings older than 90 days as stale_or_reposted (low)", () => {
      const oldDate = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString();
      const signals = detectJobRiskSignals(
        job({ postedAt: oldDate })
      );
      const stale = signals.find((s) => s.riskType === "stale_or_reposted");
      expect(stale?.severity).toBe("low");
    });

    it("flags hostnames that don't include the company name and aren't a known ATS as mismatched", () => {
      const signals = detectJobRiskSignals(
        job({
          company: "ExampleCo",
          applicationUrl: "https://random-host.example/jobs/abc"
        })
      );
      const mismatch = signals.find((s) => s.riskType === "mismatched_ats_domain");
      expect(mismatch?.severity).toBe("medium");
    });

    it("does not flag a clean Greenhouse posting", () => {
      const signals = detectJobRiskSignals(job());
      const high = signals.filter((s) => s.severity === "high");
      expect(high).toHaveLength(0);
    });

    it("highestRiskSeverity returns the most severe signal severity", () => {
      const high = [
        { severity: "low", id: "a", tenantId: "t", userId: "u", jobId: "j", riskType: "unknown", explanation: "x", recommendedAction: "", createdAt: "2026-01-01T00:00:00.000Z" },
        { severity: "high", id: "b", tenantId: "t", userId: "u", jobId: "j", riskType: "fee_request", explanation: "x", recommendedAction: "", createdAt: "2026-01-01T00:00:00.000Z" }
      ] as const;
      expect(highestRiskSeverity([...high])).toBe("high");
      expect(jobHasHighRiskSignal([...high])).toBe(true);
      expect(highestRiskSeverity([])).toBeNull();
    });
  });

  describe("generateCompanyIntelligence", () => {
    it("marks deterministic intelligence as estimated with low confidence", async () => {
      const result = await generateCompanyIntelligence(currentSession, job(), profile());
      expect(result.intelligence.source).toBe("deterministic");
      expect(result.intelligence.confidence).toBe("low");
      expect(result.intelligence.summary).toContain("Estimated");
    });

    it("emits a generated audit on first run and refreshed on subsequent runs", async () => {
      const first = await generateCompanyIntelligence(currentSession, job(), profile());
      const firstAction = first.auditEvents[0]?.action;
      expect(firstAction).toBe("company_intelligence_generated");
      const second = await generateCompanyIntelligence(currentSession, job(), profile());
      const secondAction = second.auditEvents[0]?.action;
      expect(secondAction).toBe("company_intelligence_refreshed");
    });

    it("emits one job_risk_signal_created audit per detected signal", async () => {
      const result = await generateCompanyIntelligence(
        currentSession,
        job({
          applicationUrl: "https://bit.ly/highrisk",
          description: "Send a $300 training fee to recruiter@gmail.com."
        }),
        profile()
      );
      const signalAudits = result.auditEvents.filter(
        (event) => event.action === "job_risk_signal_created"
      );
      expect(signalAudits.length).toBe(result.riskSignals.length);
      expect(result.riskSignals.length).toBeGreaterThan(0);
    });

    it("persists intelligence + risk signals to storage and intelligenceForJob loads them", async () => {
      await generateCompanyIntelligence(
        currentSession,
        job({ id: "job_persist" }),
        profile()
      );
      expect(loadCompanyIntelligence(currentSession)).toHaveLength(1);
      const view = intelligenceForJob(currentSession, "job_persist");
      expect(view.intelligence?.jobId).toBe("job_persist");
    });

    it("replaces (not duplicates) intelligence + risk signals on refresh", async () => {
      await generateCompanyIntelligence(
        currentSession,
        job({ id: "job_dedup", applicationUrl: "https://bit.ly/dup" }),
        profile()
      );
      await generateCompanyIntelligence(
        currentSession,
        job({ id: "job_dedup", applicationUrl: "https://bit.ly/dup" }),
        profile()
      );
      expect(loadCompanyIntelligence(currentSession)).toHaveLength(1);
      // Each detector emits at most one signal per job, so refreshes do not
      // accumulate duplicates.
      const signals = loadJobRiskSignals(currentSession);
      const suspiciousCount = signals.filter(
        (signal) => signal.riskType === "suspicious_domain"
      ).length;
      expect(suspiciousCount).toBe(1);
    });
  });

  describe("addRecruiterLead", () => {
    it("never invents a recruiter name when none is provided", () => {
      const result = addRecruiterLead(currentSession, {
        jobId: "job_lead",
        company: "ExampleCo",
        name: ""
      });
      expect(result.lead.name).toBe("");
      expect(result.lead.source).toBe("manual");
      expect(result.lead.confidence).toBe("low");
      expect(result.auditEvents[0].action).toBe("recruiter_lead_added");
    });

    it("persists user-entered leads and exposes them via loadRecruiterLeads", () => {
      addRecruiterLead(currentSession, {
        jobId: "job_lead",
        company: "ExampleCo",
        name: "Jane Doe",
        title: "Talent Partner",
        publicProfileUrl: "https://example.com/jane"
      });
      const leads = loadRecruiterLeads(currentSession);
      expect(leads).toHaveLength(1);
      expect(leads[0].name).toBe("Jane Doe");
    });
  });

  describe("Career Ops integration", () => {
    it("does not generate a package for a high-risk job by default and adds a warning", async () => {
      seedProfileForCurrentSession();
      saveNormalizedJobs(currentSession, [
        job({
          id: "job_block",
          applicationUrl: "https://bit.ly/highrisk_block"
        })
      ]);
      saveCareerOpsSettings(currentSession, {
        preparePackagesForHighScoreJobs: true,
        highScoreThreshold: 0,
        overrideHighRiskPackagePrep: false
      });
      const result = await runCareerOps(currentSession);
      expect(result.run.packagesPrepared).toBe(0);
      expect(loadApplicationPackages(currentSession)).toHaveLength(0);
      expect(
        result.run.digestSummary.warnings.some((warning) =>
          warning.toLowerCase().includes("high-risk")
        )
      ).toBe(true);
    });

    it("does generate a package when overrideHighRiskPackagePrep is on", async () => {
      seedProfileForCurrentSession();
      saveNormalizedJobs(currentSession, [
        job({
          id: "job_override",
          applicationUrl: "https://bit.ly/highrisk_override"
        })
      ]);
      saveCareerOpsSettings(currentSession, {
        preparePackagesForHighScoreJobs: true,
        highScoreThreshold: 0,
        overrideHighRiskPackagePrep: true
      });
      const result = await runCareerOps(currentSession);
      expect(result.run.packagesPrepared).toBeGreaterThanOrEqual(1);
      expect(loadApplicationPackages(currentSession).length).toBeGreaterThanOrEqual(1);
    });
  });
});
