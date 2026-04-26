import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { currentSession } from "../src/data/currentSession";
import type { NormalizedJob, UserProfile } from "../src/models/domain";
import {
  autopilotCanSubmit,
  loadAutopilotActions,
  loadAutopilotSettings,
  prioritizedAutopilotActions,
  runAutopilot,
  saveAutopilotSettings
} from "../src/services/autopilotService";
import { autopilotActionSchema, userProfileSchema } from "../src/models/schemas";
import { saveNormalizedJobs } from "../src/services/jobIngestion";
import { loadApplicationPackages } from "../src/services/applicationPackage";
import { scopedKey, writeJson } from "../src/lib/storage";

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
    id: "job_autopilot_test",
    tenantId: currentSession.tenant.id,
    userId: currentSession.userId,
    sourceConfigId: null,
    source: "greenhouse",
    sourceJobId: "auto_1",
    title: "Staff Product Manager",
    company: "ExampleCo",
    location: "Remote",
    remoteType: "remote",
    salaryMin: 170000,
    salaryMax: 210000,
    description:
      "ExampleCo is hiring a Staff PM for B2B SaaS workflow automation, customer discovery, roadmap delivery, and cross-functional execution.",
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

function seedProfile(overrides: Partial<UserProfile> = {}) {
  const seeded = profile(overrides);
  writeJson(
    scopedKey(currentSession.tenant.id, currentSession.userId, "profile"),
    seeded
  );
  return seeded;
}

beforeEach(() => {
  installLocalStorageMock();
});

afterEach(() => {
  // @ts-expect-error allow re-installing the mock
  delete globalThis.window;
});

describe("autopilotService — hard safety invariants", () => {
  it("autopilotCanSubmit always returns false", () => {
    expect(autopilotCanSubmit()).toBe(false);
  });

  it("rejects any attempt to disable requireApprovalBeforeSubmit", () => {
    expect(() =>
      saveAutopilotSettings(currentSession, {
        requireApprovalBeforeSubmit: false as unknown as true
      })
    ).toThrow(/cannot be disabled/i);
    const persisted = loadAutopilotSettings(currentSession);
    expect(persisted.requireApprovalBeforeSubmit).toBe(true);
  });

  it("never allows requireApprovalBeforeSubmit to be persisted as false", () => {
    saveAutopilotSettings(currentSession, { enabled: true });
    saveAutopilotSettings(currentSession, { runFrequency: "daily" });
    const persisted = loadAutopilotSettings(currentSession);
    expect(persisted.requireApprovalBeforeSubmit).toBe(true);
  });
});

describe("autopilotService — package preparation safety", () => {
  it("does not prepare packages for excluded companies", async () => {
    seedProfile({ companiesToAvoid: ["ExampleCo"] });
    saveNormalizedJobs(currentSession, [
      job({ id: "job_avoid_excluded", company: "ExampleCo" })
    ]);
    saveAutopilotSettings(currentSession, {
      enabled: true,
      autoPreparePackagesForHighScoreJobs: true,
      highScoreThreshold: 0
    });
    const result = await runAutopilot(currentSession, {
      triggeredBy: "manual"
    });
    expect(loadApplicationPackages(currentSession)).toHaveLength(0);
    expect(
      result.blockedReasons.some((reason) =>
        reason.toLowerCase().includes("avoid")
      )
    ).toBe(true);
  });

  it("blocks package preparation for high-risk jobs unless overridden", async () => {
    seedProfile();
    saveNormalizedJobs(currentSession, [
      job({
        id: "job_risk_block",
        applicationUrl: "https://bit.ly/risky_test"
      })
    ]);
    saveAutopilotSettings(currentSession, {
      enabled: true,
      autoPreparePackagesForHighScoreJobs: true,
      highScoreThreshold: 0
    });
    const result = await runAutopilot(currentSession, {
      triggeredBy: "manual"
    });
    expect(loadApplicationPackages(currentSession)).toHaveLength(0);
    expect(
      result.blockedReasons.some((reason) =>
        reason.toLowerCase().includes("high-risk")
      )
    ).toBe(true);
  });
});

describe("autopilotService — Action Center", () => {
  it("creates a review_high_match_job action for each high-score job", async () => {
    seedProfile();
    saveNormalizedJobs(currentSession, [
      job({ id: "job_review_action" })
    ]);
    saveAutopilotSettings(currentSession, {
      enabled: true,
      highScoreThreshold: 0
    });
    const result = await runAutopilot(currentSession, {
      triggeredBy: "manual"
    });
    const action = result.actions.find(
      (item) =>
        item.type === "review_high_match_job" && item.jobId === "job_review_action"
    );
    expect(action).toBeDefined();
    expect(action?.status).toBe("pending");
  });

  it("creates a missing-work-authorization action only when needed", async () => {
    seedProfile({ workAuthorization: "" });
    saveNormalizedJobs(currentSession, [
      job({ id: "job_missing_auth" })
    ]);
    saveAutopilotSettings(currentSession, {
      enabled: true,
      highScoreThreshold: 0
    });
    const result = await runAutopilot(currentSession, {
      triggeredBy: "manual"
    });
    const action = result.actions.find(
      (item) => item.type === "add_missing_work_authorization"
    );
    expect(action).toBeDefined();
  });

  it("prioritises approve_submit above low-urgency missing-info actions", () => {
    const submitAction = autopilotActionSchema.parse({
      id: "action_submit_priority",
      tenantId: currentSession.tenant.id,
      userId: currentSession.userId,
      type: "approve_submit",
      title: "Approve submit",
      reason: "Test",
      urgency: "high",
      jobId: null,
      applicationRecordId: null,
      applicationPackageId: null,
      primaryCtaLabel: "Approve",
      primaryCtaRoute: "tracker",
      secondaryCtaLabel: "",
      secondaryCtaRoute: "",
      status: "pending",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: null,
      dismissedAt: null,
      snoozedUntil: null
    });
    const linkedinAction = autopilotActionSchema.parse({
      id: "action_linkedin",
      tenantId: currentSession.tenant.id,
      userId: currentSession.userId,
      type: "add_linkedin_url",
      title: "Add LinkedIn URL",
      reason: "Optional",
      urgency: "low",
      jobId: null,
      applicationRecordId: null,
      applicationPackageId: null,
      primaryCtaLabel: "Update",
      primaryCtaRoute: "career-profile",
      secondaryCtaLabel: "",
      secondaryCtaRoute: "",
      status: "pending",
      createdAt: new Date(Date.now() - 60_000).toISOString(),
      updatedAt: new Date(Date.now() - 60_000).toISOString(),
      completedAt: null,
      dismissedAt: null,
      snoozedUntil: null
    });
    const ordered = prioritizedAutopilotActions([linkedinAction, submitAction]);
    const submitIndex = ordered.findIndex((item) => item.id === submitAction.id);
    const linkedinIndex = ordered.findIndex(
      (item) => item.id === linkedinAction.id
    );
    expect(submitIndex).toBeGreaterThanOrEqual(0);
    expect(linkedinIndex).toBeGreaterThan(submitIndex);
  });
});

describe("autopilotService — idempotency", () => {
  it("does not duplicate packages or actions on a second run", async () => {
    seedProfile();
    saveNormalizedJobs(currentSession, [job({ id: "job_idempotent" })]);
    saveAutopilotSettings(currentSession, {
      enabled: true,
      autoPreparePackagesForHighScoreJobs: true,
      highScoreThreshold: 0
    });
    const first = await runAutopilot(currentSession, {
      triggeredBy: "manual"
    });
    const firstPackages = loadApplicationPackages(currentSession).length;
    const firstReviewActions = first.actions.filter(
      (action) => action.type === "review_application_package"
    ).length;
    const second = await runAutopilot(currentSession, {
      triggeredBy: "manual"
    });
    const secondPackages = loadApplicationPackages(currentSession).length;
    const secondReviewActions = second.actions.filter(
      (action) => action.type === "review_application_package"
    ).length;
    expect(secondPackages).toBe(firstPackages);
    expect(secondReviewActions).toBe(firstReviewActions);
  });
});

describe("autopilotService — action lifecycle", () => {
  it("loadAutopilotActions returns the persisted action list", async () => {
    seedProfile();
    saveNormalizedJobs(currentSession, [job({ id: "job_lifecycle" })]);
    saveAutopilotSettings(currentSession, {
      enabled: true,
      highScoreThreshold: 0
    });
    await runAutopilot(currentSession, { triggeredBy: "manual" });
    const stored = loadAutopilotActions(currentSession);
    expect(stored.length).toBeGreaterThan(0);
    expect(stored.every((action) => action.status === "pending")).toBe(true);
  });
});
