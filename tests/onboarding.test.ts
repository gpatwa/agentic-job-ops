import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { currentSession } from "../src/data/currentSession";
import type { NormalizedJob, UserProfile } from "../src/models/domain";
import { saveNormalizedJobs } from "../src/services/jobIngestion";
import { loadApplications } from "../src/services/applicationService";
import {
  isDemoJob,
  isOnboardingComplete,
  loadOnboardingState,
  recommendApplyReadyJobs,
  recordOnboardingApplicationPrepStarted,
  recordOnboardingCompleted,
  recordOnboardingJobReviewed,
  recordTargetRolesSelected
} from "../src/services/onboardingJobRecommendationService";
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
    targetTitles: ["Senior Product Manager"],
    targetLocations: ["Remote"],
    targetIndustries: ["B2B SaaS", "Workflow Automation"],
    remotePreference: "remote",
    salaryMin: 150000,
    salaryTarget: 180000,
    companiesToAvoid: [],
    companiesToPrioritize: [],
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

function realJob(overrides: Partial<NormalizedJob> = {}): NormalizedJob {
  const now = new Date().toISOString();
  return {
    id: "job_real_1",
    tenantId: currentSession.tenant.id,
    userId: currentSession.userId,
    sourceConfigId: null,
    source: "greenhouse",
    sourceJobId: "real_1",
    title: "Senior Product Manager",
    company: "RealCo",
    location: "Remote",
    remoteType: "remote",
    salaryMin: 170000,
    salaryMax: 210000,
    description:
      "RealCo is hiring a Senior Product Manager for B2B SaaS workflow automation, customer discovery, and roadmap delivery.",
    responsibilities: ["Lead discovery"],
    requirements: ["B2B SaaS PM"],
    applicationUrl: "https://boards.greenhouse.io/realco/jobs/123",
    atsType: "greenhouse",
    postedAt: now,
    discoveredAt: now,
    scoringStatus: "queued",
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

describe("onboardingJobRecommendationService", () => {
  beforeEach(() => installLocalStorageMock());
  afterEach(() => Reflect.deleteProperty(globalThis, "window"));

  describe("recordTargetRolesSelected", () => {
    it("persists selected roles and emits an audit event", async () => {
      const result = await recordTargetRolesSelected(currentSession, [
        "Senior Product Manager",
        "  Staff Product Manager  ",
        "Senior Product Manager" // duplicate, should be deduped + trimmed
      ]);
      expect(result.state.selectedTargetRoles).toEqual([
        "Senior Product Manager",
        "Staff Product Manager"
      ]);
      expect(result.auditEvents[0].action).toBe(
        "onboarding_target_roles_selected"
      );
    });

    it("ignores empty role strings", async () => {
      const result = await recordTargetRolesSelected(currentSession, ["", "  "]);
      expect(result.state.selectedTargetRoles).toEqual([]);
    });
  });

  describe("recommendApplyReadyJobs", () => {
    it("creates clearly-labeled demo jobs when no real jobs exist", async () => {
      const result = await recommendApplyReadyJobs(currentSession, {
        targetRoles: ["Senior Product Manager"],
        profile: profile()
      });
      expect(result.demoJobsCreated).toBeGreaterThan(0);
      expect(result.showsDemoBanner).toBe(true);
      result.jobs.forEach((job) => {
        expect(isDemoJob(job)).toBe(true);
        expect(job.id.startsWith("demo_job_")).toBe(true);
        expect(job.description.startsWith("[Demo job]")).toBe(true);
      });
    });

    it("returns existing matching jobs and does not seed demo jobs when real jobs exist", async () => {
      saveNormalizedJobs(currentSession, [realJob()]);
      const result = await recommendApplyReadyJobs(currentSession, {
        targetRoles: ["Senior Product Manager"],
        profile: profile()
      });
      expect(result.demoJobsCreated).toBe(0);
      expect(result.showsDemoBanner).toBe(false);
      expect(result.jobs.some((job) => job.id === "job_real_1")).toBe(true);
    });

    it("groups results into Strong / Possible / Browse buckets, strong first", async () => {
      const result = await recommendApplyReadyJobs(currentSession, {
        targetRoles: ["Senior Product Manager"],
        profile: profile()
      });
      expect(result.groups.map((group) => group.label)).toEqual([
        "Strong matches",
        "Possible matches",
        "Browse / lower matches"
      ]);
      expect(
        result.groups[0].matches.length +
          result.groups[1].matches.length +
          result.groups[2].matches.length
      ).toBe(result.jobs.length);
    });

    it("returns a data demo job for a data role", async () => {
      const result = await recommendApplyReadyJobs(currentSession, {
        targetRoles: ["Senior Data Scientist"],
        profile: profile({ targetTitles: ["Senior Data Scientist"] })
      });
      const titles = result.jobs.map((job) => job.title.toLowerCase());
      expect(
        titles.some((title) => title.includes("data") || title.includes("analyt"))
      ).toBe(true);
    });

    it("does not create demo jobs when allowDemoJobs is false", async () => {
      const result = await recommendApplyReadyJobs(currentSession, {
        targetRoles: ["Senior Product Manager"],
        profile: profile(),
        allowDemoJobs: false
      });
      expect(result.demoJobsCreated).toBe(0);
      expect(result.jobs).toHaveLength(0);
      expect(result.groups.every((group) => group.matches.length === 0)).toBe(true);
    });

    it("never moves an application to submitted or fires application_submitted audit", async () => {
      const result = await recommendApplyReadyJobs(currentSession, {
        targetRoles: ["Senior Product Manager"],
        profile: profile()
      });
      const apps = loadApplications(currentSession);
      expect(apps.filter((app) => app.status === "submitted")).toHaveLength(0);
      expect(
        result.auditEvents.some(
          (event) => event.action === "application_submitted"
        )
      ).toBe(false);
    });

    it("emits onboarding_jobs_recommended (and onboarding_demo_jobs_created when demo jobs are made)", async () => {
      const result = await recommendApplyReadyJobs(currentSession, {
        targetRoles: ["Senior Product Manager"],
        profile: profile()
      });
      const actions = result.auditEvents.map((event) => event.action);
      expect(actions).toContain("onboarding_target_roles_selected");
      expect(actions).toContain("onboarding_demo_jobs_created");
      expect(actions).toContain("onboarding_jobs_recommended");
    });

    it("flags onboardingJobsScored and firstApplyReadyJobsShown after a recommendation run", async () => {
      const result = await recommendApplyReadyJobs(currentSession, {
        targetRoles: ["Senior Product Manager"],
        profile: profile()
      });
      expect(result.state.onboardingJobsGenerated).toBe(true);
      expect(result.state.onboardingJobsScored).toBe(true);
      expect(result.state.firstApplyReadyJobsShown).toBe(true);
    });
  });

  describe("recordOnboardingJobReviewed + completion", () => {
    it("marks the first job reviewed", async () => {
      const recommended = await recommendApplyReadyJobs(currentSession, {
        targetRoles: ["Senior Product Manager"],
        profile: profile()
      });
      const job = recommended.jobs[0];
      const result = await recordOnboardingJobReviewed(currentSession, job.id);
      expect(result.state.firstJobReviewed).toBe(true);
      expect(result.auditEvents[0].action).toBe("onboarding_job_review_started");
    });

    it("recordOnboardingApplicationPrepStarted also marks reviewed and emits prep_started audit", async () => {
      const recommended = await recommendApplyReadyJobs(currentSession, {
        targetRoles: ["Senior Product Manager"],
        profile: profile()
      });
      const job = recommended.jobs[0];
      const result = await recordOnboardingApplicationPrepStarted(
        currentSession,
        job.id
      );
      expect(result.state.firstJobReviewed).toBe(true);
      expect(result.auditEvents[0].action).toBe(
        "onboarding_application_prep_started"
      );
    });

    it("recordOnboardingCompleted sets onboardingCompletedAt only once", async () => {
      const first = await recordOnboardingCompleted(
        currentSession,
        "user_chose_dashboard"
      );
      expect(first.state.onboardingCompletedAt).not.toBeNull();
      expect(first.auditEvents[0].action).toBe("onboarding_completed");
      const stamp = first.state.onboardingCompletedAt;
      // Idempotent: re-completing returns the same timestamp and emits no audit.
      const second = await recordOnboardingCompleted(
        currentSession,
        "user_chose_dashboard"
      );
      expect(second.state.onboardingCompletedAt).toBe(stamp);
      expect(second.auditEvents).toHaveLength(0);
    });

    it("isOnboardingComplete is true when target roles + jobs shown + first job reviewed", async () => {
      const recommended = await recommendApplyReadyJobs(currentSession, {
        targetRoles: ["Senior Product Manager"],
        profile: profile()
      });
      await recordOnboardingJobReviewed(
        currentSession,
        recommended.jobs[0].id
      );
      expect(isOnboardingComplete(loadOnboardingState(currentSession))).toBe(
        true
      );
    });
  });
});
