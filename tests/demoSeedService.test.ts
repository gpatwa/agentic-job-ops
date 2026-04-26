import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { currentSession } from "../src/data/currentSession";
import { loadApplications } from "../src/services/applicationService";
import {
  loadApplicationAnswers,
  loadApplicationPackages
} from "../src/services/applicationPackage";
import {
  loadAutopilotActions,
  loadAutopilotSettings
} from "../src/services/autopilotService";
import {
  seedRealisticB2cDemo,
  summarizeDemoSeedWorkspace
} from "../src/services/demoSeedService";
import { loadCompanyIntelligence } from "../src/services/intelligenceService";
import { loadNormalizedJobs } from "../src/services/jobIngestion";
import { loadJobMatches } from "../src/services/matchEngine";
import { loadOnboardingState } from "../src/services/onboardingJobRecommendationService";
import { loadUserProfile, saveUserProfile } from "../src/services/profileService";
import { loadFollowUpReminders } from "../src/services/recruiterCrmService";
import { loadResume } from "../src/services/resumeService";
import {
  loadJobTargetRecommendations,
  loadResumeIntelligenceReports
} from "../src/services/resumeIntelligenceService";

function installLocalStorageMock() {
  const store = new Map<string, string>();
  const localStorage = {
    get length() {
      return store.size;
    },
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
      Object.defineProperty(localStorage, key, {
        value,
        writable: true,
        configurable: true,
        enumerable: true
      });
    },
    removeItem: (key: string) => {
      store.delete(key);
      Reflect.deleteProperty(localStorage, key);
    },
    clear: () => {
      Array.from(store.keys()).forEach((key) => {
        store.delete(key);
        Reflect.deleteProperty(localStorage, key);
      });
    }
  };

  Object.defineProperty(globalThis, "window", {
    value: { localStorage },
    configurable: true
  });
}

describe("realistic B2C demo seed", () => {
  beforeEach(() => installLocalStorageMock());
  afterEach(() => Reflect.deleteProperty(globalThis, "window"));

  it("creates a clearly labeled happy-path workspace without submitted applications", async () => {
    const result = await seedRealisticB2cDemo(currentSession);

    expect(result.resume.parsedText).toContain("[Demo]");
    expect(loadResume(currentSession)?.originalFileName).toContain("demo");
    expect(loadUserProfile(currentSession)?.fullName).toContain("Demo");

    expect(loadResumeIntelligenceReports(currentSession)).toHaveLength(1);
    expect(loadJobTargetRecommendations(currentSession)).toHaveLength(1);
    expect(loadOnboardingState(currentSession).selectedTargetRoles).toContain(
      "Senior Product Manager"
    );
    expect(loadOnboardingState(currentSession).onboardingCompletedAt).not.toBeNull();

    const jobs = loadNormalizedJobs(currentSession);
    const matches = loadJobMatches(currentSession);
    expect(jobs).toHaveLength(8);
    expect(jobs.every((job) => job.title.includes("[Demo]"))).toBe(true);
    expect(matches).toHaveLength(8);
    expect(matches.some((match) => match.queue === "apply_review")).toBe(true);
    expect(matches.some((match) => match.queue === "browse")).toBe(true);

    const applications = loadApplications(currentSession);
    const packages = loadApplicationPackages(currentSession);
    expect(applications).toHaveLength(2);
    expect(applications.every((application) => application.status !== "submitted")).toBe(
      true
    );
    expect(packages).toHaveLength(2);
    expect(packages.every((applicationPackage) => applicationPackage.status === "ready_for_review")).toBe(
      true
    );
    expect(loadApplicationAnswers(currentSession)).toHaveLength(8);

    expect(loadFollowUpReminders(currentSession)).toHaveLength(1);
    expect(loadCompanyIntelligence(currentSession)).toHaveLength(1);
    expect(loadAutopilotSettings(currentSession).enabled).toBe(true);
    expect(loadAutopilotActions(currentSession).length).toBeGreaterThanOrEqual(3);
  });

  it("refuses to replace non-demo user data without confirmation", async () => {
    saveUserProfile(
      currentSession,
      {
        fullName: "Real User",
        email: "real@example.com",
        phone: "",
        location: "Remote",
        workAuthorization: "",
        linkedinUrl: "",
        portfolioUrl: "",
        githubUrl: "",
        targetTitles: "Senior Product Manager",
        targetLocations: "Remote",
        targetIndustries: "B2B SaaS",
        remotePreference: "remote",
        salaryMin: "",
        salaryTarget: "",
        companiesToAvoid: "",
        companiesToPrioritize: "",
        careerSummary: "Real profile data",
        verifiedFacts: "Real verified fact"
      },
      null
    );

    expect(summarizeDemoSeedWorkspace(currentSession).hasNonDemoUserData).toBe(true);
    await expect(seedRealisticB2cDemo(currentSession)).rejects.toThrow(
      "non-demo data"
    );
  });

  it("can refresh an existing demo workspace without creating submitted records", async () => {
    await seedRealisticB2cDemo(currentSession);
    await seedRealisticB2cDemo(currentSession);

    expect(loadNormalizedJobs(currentSession)).toHaveLength(8);
    expect(loadApplicationPackages(currentSession)).toHaveLength(2);
    expect(
      loadApplications(currentSession).filter(
        (application) => application.status === "submitted"
      )
    ).toHaveLength(0);
  });
});
