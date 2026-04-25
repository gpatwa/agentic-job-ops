import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { currentSession } from "../src/data/currentSession";
import type { JobMatch } from "../src/models/domain";
import {
  applyDashboardJobAction,
  changeApplicationStatus
} from "../src/services/applicationWorkflow";
import { saveJobMatches } from "../src/services/matchEngine";

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

function match(overrides: Partial<JobMatch> = {}): JobMatch {
  const now = new Date().toISOString();

  return {
    id: "match_1",
    tenantId: currentSession.tenant.id,
    userId: currentSession.userId,
    jobId: "job_1",
    overallScore: 5.2,
    skillsScore: 5,
    experienceScore: 5,
    seniorityScore: 5,
    locationScore: 5,
    salaryScore: 5,
    industryScore: 5,
    companyFitScore: 5,
    applicationEffortScore: 5,
    strategicValueScore: 5,
    recommendation: "browse",
    queue: "browse",
    topMatchReasons: ["Some overlap"],
    topGaps: ["Some gaps"],
    employerLookingFor: ["Evidence"],
    summary: "Summary",
    recommendedNextAction: "Browse only.",
    scoringVersion: "test",
    modelName: "test",
    promptVersion: "test",
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

describe("application workflow actions", () => {
  beforeEach(() => {
    installLocalStorageMock();
  });

  afterEach(() => {
    Reflect.deleteProperty(globalThis, "window");
  });

  it("creates a saved application record", () => {
    const result = applyDashboardJobAction(
      currentSession,
      "job_1",
      "save_for_later"
    );

    expect(result.application.status).toBe("saved");
    expect(result.application.tenantId).toBe(currentSession.tenant.id);
    expect(result.application.userId).toBe(currentSession.userId);
    expect(result.auditAction).toBe("job_saved");
    expect(result.auditMetadata.notesLength).toBe(0);
  });

  it("moves a job match into Apply Review as a user override", () => {
    saveJobMatches(currentSession, [match()]);

    const result = applyDashboardJobAction(
      currentSession,
      "job_1",
      "move_to_apply_review"
    );

    expect(result.application.status).toBe("recommended");
    expect(result.matches[0].queue).toBe("apply_review");
    expect(result.matches[0].recommendation).toBe("apply");
    expect(result.auditAction).toBe("job_promoted_to_apply_review");
  });

  it("marks manual submitted status only through explicit status change", () => {
    const saved = applyDashboardJobAction(currentSession, "job_1", "save_for_later");
    const result = changeApplicationStatus(
      currentSession,
      saved.application.id,
      "submitted"
    );

    expect(result.application.status).toBe("submitted");
    expect(result.auditAction).toBe("manually_applied");
  });
});
