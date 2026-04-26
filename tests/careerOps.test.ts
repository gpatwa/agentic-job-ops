import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { currentSession } from "../src/data/currentSession";
import type {
  ApplicationRecord,
  NormalizedJob,
  UserProfile
} from "../src/models/domain";
import {
  isCareerOpsRunDue,
  loadCareerOpsRuns,
  loadCareerOpsSettings,
  nextScheduledRunAt,
  runCareerOps,
  saveCareerOpsSettings,
  summarizeCareerOps
} from "../src/services/careerOpsService";
import { saveNormalizedJobs } from "../src/services/jobIngestion";
import { loadApplications } from "../src/services/applicationService";
import { loadApplicationPackages } from "../src/services/applicationPackage";
import { loadAuditLogs } from "../src/services/auditLog";
import { userProfileSchema } from "../src/models/schemas";
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
    careerSummary:
      "Product leader focused on B2B SaaS workflow automation and customer discovery.",
    verifiedFacts: [
      "Led B2B SaaS workflow automation launches",
      "Partnered with engineering and design on customer discovery"
    ],
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides
  });
}

function job(overrides: Partial<NormalizedJob> = {}): NormalizedJob {
  const timestamp = new Date().toISOString();
  return {
    id: "job_test_1",
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
    responsibilities: [
      "Lead customer discovery",
      "Partner with engineering and design on roadmap delivery",
      "Launch workflow automation products"
    ],
    requirements: [
      "B2B SaaS product management experience",
      "Workflow automation launch experience",
      "Customer discovery experience"
    ],
    applicationUrl: "https://boards.greenhouse.io/example/jobs/123",
    atsType: "greenhouse",
    postedAt: timestamp,
    discoveredAt: timestamp,
    scoringStatus: "queued",
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides
  };
}

function seedProfile(overrides: Partial<UserProfile> = {}) {
  const merged = profile(overrides);
  window.localStorage.setItem(
    scopedKey(currentSession.tenant.id, currentSession.userId, "profile"),
    JSON.stringify(merged)
  );
}

describe("careerOpsService", () => {
  beforeEach(() => installLocalStorageMock());
  afterEach(() => Reflect.deleteProperty(globalThis, "window"));

  describe("settings", () => {
    it("returns sensible defaults the first time", () => {
      const settings = loadCareerOpsSettings(currentSession);
      expect(settings.scheduleMode).toBe("manual_only");
      expect(settings.preparePackagesForHighScoreJobs).toBe(false);
      expect(settings.highScoreThreshold).toBe(8.0);
    });

    it("persists user choices and round-trips", () => {
      saveCareerOpsSettings(currentSession, {
        scheduleMode: "every_6_hours",
        preparePackagesForHighScoreJobs: true,
        highScoreThreshold: 7.5
      });
      const reloaded = loadCareerOpsSettings(currentSession);
      expect(reloaded.scheduleMode).toBe("every_6_hours");
      expect(reloaded.preparePackagesForHighScoreJobs).toBe(true);
      expect(reloaded.highScoreThreshold).toBe(7.5);
    });
  });

  describe("schedule helpers", () => {
    it("returns null next-run for disabled or manual-only schedules", () => {
      const settings = saveCareerOpsSettings(currentSession, {
        scheduleMode: "disabled"
      });
      expect(nextScheduledRunAt(settings, null)).toBeNull();
      const manual = saveCareerOpsSettings(currentSession, {
        scheduleMode: "manual_only"
      });
      expect(nextScheduledRunAt(manual, null)).toBeNull();
    });

    it("computes next run from last run + interval for daily and 6h", () => {
      const settings = saveCareerOpsSettings(currentSession, {
        scheduleMode: "daily"
      });
      const last = "2026-04-01T00:00:00.000Z";
      expect(nextScheduledRunAt(settings, last, new Date(last))).toBe(
        "2026-04-02T00:00:00.000Z"
      );
      const sixHour = saveCareerOpsSettings(currentSession, {
        scheduleMode: "every_6_hours"
      });
      expect(nextScheduledRunAt(sixHour, last, new Date(last))).toBe(
        "2026-04-01T06:00:00.000Z"
      );
    });

    it("isCareerOpsRunDue returns true when the schedule has elapsed", () => {
      const settings = saveCareerOpsSettings(currentSession, {
        scheduleMode: "daily"
      });
      const last = new Date("2026-04-01T00:00:00.000Z");
      const now = new Date("2026-04-02T01:00:00.000Z");
      expect(isCareerOpsRunDue(settings, last.toISOString(), now)).toBe(true);
      const earlier = new Date("2026-04-01T12:00:00.000Z");
      expect(isCareerOpsRunDue(settings, last.toISOString(), earlier)).toBe(false);
    });
  });

  describe("runCareerOps", () => {
    it("marks the run completed and produces a digest with recommendation", async () => {
      seedProfile();
      saveNormalizedJobs(currentSession, [job()]);
      const result = await runCareerOps(currentSession);
      expect(result.run.status).toBe("completed");
      expect(result.run.jobsScored).toBeGreaterThan(0);
      expect(result.run.digestSummary.lines.length).toBe(5);
      expect(result.run.digestSummary.recommendedNextAction).toMatch(/Apply|Maybe|Browse|sources/);
      expect(result.auditEvents.map((e) => e.action)).toContain("career_ops_run_started");
      expect(result.auditEvents.map((e) => e.action)).toContain("career_ops_digest_created");
      expect(result.auditEvents.map((e) => e.action)).toContain("career_ops_run_completed");
    });

    it("does not duplicate jobs across consecutive runs", async () => {
      seedProfile();
      saveNormalizedJobs(currentSession, [job()]);
      const first = await runCareerOps(currentSession);
      expect(first.run.jobsScored).toBe(1);
      const second = await runCareerOps(currentSession);
      expect(second.run.jobsScored).toBe(0);
      // No new job records created.
      const allJobs = JSON.parse(
        window.localStorage.getItem(
          scopedKey(currentSession.tenant.id, currentSession.userId, "normalized_jobs")
        ) || "[]"
      );
      expect(allJobs).toHaveLength(1);
    });

    it("warns and creates no package for avoided companies even with prep enabled", async () => {
      seedProfile({ companiesToAvoid: ["BlockedCo"] });
      saveNormalizedJobs(currentSession, [
        job({ id: "job_blocked", company: "BlockedCo" })
      ]);
      saveCareerOpsSettings(currentSession, {
        preparePackagesForHighScoreJobs: true,
        highScoreThreshold: 0
      });
      const result = await runCareerOps(currentSession);
      expect(result.run.packagesPrepared).toBe(0);
      expect(loadApplicationPackages(currentSession)).toHaveLength(0);
      expect(
        result.run.digestSummary.warnings.some((warning) =>
          warning.toLowerCase().includes("avoided")
        )
      ).toBe(true);
    });

    it("warns when the profile is incomplete", async () => {
      // Do not seed a profile.
      saveNormalizedJobs(currentSession, [job()]);
      const result = await runCareerOps(currentSession);
      expect(
        result.run.digestSummary.warnings.some((warning) =>
          warning.toLowerCase().includes("profile is incomplete")
        )
      ).toBe(true);
    });

    it("never moves an application to submitted or fires application_submitted audit", async () => {
      seedProfile();
      saveNormalizedJobs(currentSession, [job()]);
      saveCareerOpsSettings(currentSession, {
        preparePackagesForHighScoreJobs: true,
        highScoreThreshold: 0
      });
      const result = await runCareerOps(currentSession);
      const applications: ApplicationRecord[] = loadApplications(currentSession);
      const submitted = applications.filter((app) => app.status === "submitted");
      expect(submitted).toHaveLength(0);
      expect(
        result.auditEvents.some((event) => event.action === "application_submitted")
      ).toBe(false);
    });

    it("routes a strong-fit job to apply_review (high match count)", async () => {
      seedProfile();
      saveNormalizedJobs(currentSession, [job()]);
      const result = await runCareerOps(currentSession);
      expect(result.run.applyReviewCount).toBeGreaterThan(0);
    });

    it("keeps weak-fit jobs in browse instead of dropping them", async () => {
      seedProfile({
        targetTitles: ["Underwater Welder"],
        targetIndustries: ["Welding"]
      });
      saveNormalizedJobs(currentSession, [
        job({
          id: "job_weak",
          title: "Junior Florist",
          company: "Bouquets Inc",
          description: "Floral arrangement.",
          responsibilities: ["Trim stems"],
          requirements: ["Floral training"]
        })
      ]);
      const result = await runCareerOps(currentSession);
      expect(result.run.browseCount).toBeGreaterThan(0);
    });

    it("records every stage event in the audit log via the returned events", async () => {
      seedProfile();
      saveNormalizedJobs(currentSession, [job()]);
      saveCareerOpsSettings(currentSession, {
        preparePackagesForHighScoreJobs: true,
        highScoreThreshold: 0
      });
      const result = await runCareerOps(currentSession);
      const actions = result.auditEvents.map((event) => event.action);
      expect(actions).toContain("career_ops_run_started");
      expect(actions).toContain("career_ops_ingestion_completed");
      expect(actions).toContain("career_ops_scoring_completed");
      expect(actions).toContain("career_ops_package_preparation_completed");
      expect(actions).toContain("career_ops_digest_created");
      expect(actions).toContain("career_ops_run_completed");
    });

    it("persists run history (latest first) and exposes it via loadCareerOpsRuns", async () => {
      seedProfile();
      saveNormalizedJobs(currentSession, [job()]);
      await runCareerOps(currentSession);
      saveNormalizedJobs(currentSession, [
        job({ id: "job_test_2", sourceJobId: "test_2" })
      ]);
      await runCareerOps(currentSession);
      const runs = loadCareerOpsRuns(currentSession);
      expect(runs).toHaveLength(2);
      expect(new Date(runs[0].startedAt).getTime()).toBeGreaterThanOrEqual(
        new Date(runs[1].startedAt).getTime()
      );
    });
  });

  describe("summarizeCareerOps", () => {
    it("returns latest run, count, and next scheduled time", async () => {
      const settings = saveCareerOpsSettings(currentSession, {
        scheduleMode: "daily"
      });
      seedProfile();
      saveNormalizedJobs(currentSession, [job()]);
      await runCareerOps(currentSession);
      const summary = summarizeCareerOps(
        loadCareerOpsRuns(currentSession),
        settings
      );
      expect(summary.totalRuns).toBe(1);
      expect(summary.latestRun?.status).toBe("completed");
      expect(summary.nextScheduledRunAt).not.toBeNull();
      expect(summary.lastSuccessfulRunAt).not.toBeNull();
    });
  });
});
