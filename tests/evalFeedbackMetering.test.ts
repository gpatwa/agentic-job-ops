import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { currentSession } from "../src/data/currentSession";
import type { ApplicationRecord } from "../src/models/domain";
import {
  loadAIOutputMetadata,
  recordAIOutputMetadata
} from "../src/services/aiOutputMetadata";
import {
  loadApplicationOutcomes,
  recordApplicationOutcome
} from "../src/services/applicationOutcomeService";
import { loadEvalResults, runEvalSuite } from "../src/services/evalService";
import {
  appendFeedbackEvent,
  loadFeedbackEvents,
  summarizeFeedbackEvents
} from "../src/services/feedbackService";
import {
  appendUsageMeteringEvent,
  loadUsageMeteringEvents,
  summarizeUsageByEvent,
  summarizeUsageByTenant
} from "../src/services/usageMetering";

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

function application(status: ApplicationRecord["status"]): ApplicationRecord {
  const now = new Date().toISOString();
  return {
    id: "app_1",
    tenantId: currentSession.tenant.id,
    userId: currentSession.userId,
    jobId: "job_1",
    status,
    notes: "",
    createdAt: now,
    updatedAt: now
  };
}

describe("Phase 7 feedback, usage, outcomes, metadata, and evals", () => {
  beforeEach(() => {
    installLocalStorageMock();
  });

  afterEach(() => {
    Reflect.deleteProperty(globalThis, "window");
  });

  it("records and summarizes feedback events without sensitive payloads", () => {
    appendFeedbackEvent(currentSession, {
      eventType: "job_saved",
      resourceType: "ApplicationRecord",
      resourceId: "app_1",
      metadata: { jobId: "job_1" }
    });
    appendFeedbackEvent(currentSession, {
      eventType: "job_saved",
      resourceType: "ApplicationRecord",
      resourceId: "app_2"
    });
    appendFeedbackEvent(currentSession, {
      eventType: "application_package_approved",
      resourceType: "ApplicationPackage",
      resourceId: "pkg_1"
    });

    const events = loadFeedbackEvents(currentSession);
    expect(events).toHaveLength(3);
    expect(summarizeFeedbackEvents(events)).toMatchObject({
      job_saved: 2,
      application_package_approved: 1
    });
  });

  it("records usage by event and tenant", () => {
    appendUsageMeteringEvent(currentSession, {
      eventType: "job_ingested",
      resourceType: "ScanRun",
      resourceId: "scan_1",
      quantity: 3
    });
    appendUsageMeteringEvent(currentSession, {
      eventType: "job_scored",
      resourceType: "JobMatch",
      resourceId: "batch",
      quantity: 2
    });

    const events = loadUsageMeteringEvents(currentSession);
    expect(summarizeUsageByEvent(events)).toMatchObject({
      job_ingested: 3,
      job_scored: 2
    });
    expect(summarizeUsageByTenant(events)[currentSession.tenant.id]).toBe(5);
  });

  it("records outcomes and centralized AI output metadata", () => {
    const outcome = recordApplicationOutcome(
      currentSession,
      application("interviewing"),
      "interview_scheduled"
    );
    const metadata = recordAIOutputMetadata(currentSession, {
      outputType: "application_package",
      resourceType: "ApplicationPackage",
      resourceId: "pkg_1",
      modelName: "deterministic-package-fallback",
      promptVersion: "application-package-v1",
      inputHash: "input",
      outputHash: "output"
    });

    expect(outcome.outcome).toBe("interview_scheduled");
    expect(loadApplicationOutcomes(currentSession)).toHaveLength(1);
    expect(metadata.tokenInput).toBe(0);
    expect(loadAIOutputMetadata(currentSession)).toHaveLength(1);
  });

  it("runs deterministic eval suites and persists pass/fail results", async () => {
    const result = await runEvalSuite(currentSession);

    expect(result.run.passCount).toBeGreaterThan(0);
    expect(result.run.failCount).toBe(0);
    expect(result.results.every((item) => item.status === "passed")).toBe(true);
    expect(loadEvalResults(currentSession)).toHaveLength(result.results.length);
  });
});
