import { describe, expect, it } from "vitest";
import type { ApplicationAnswer, ApplicationPackage, UserProfile } from "../src/models/domain";
import {
  GreenhouseATSAdapter,
  LeverATSAdapter,
  greenhouseFixturePage,
  leverFixturePage
} from "../src/services/atsAdapters";
import { createATSBrowserAutomationAdapter } from "../src/services/browserApplicationAssistant";
import { currentSession } from "../src/data/currentSession";
import { createEmptyProfile } from "../src/services/profileService";

function profile(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    ...createEmptyProfile(currentSession),
    fullName: "Example User",
    email: "example@example.com",
    phone: "555-0100",
    location: "Remote",
    linkedinUrl: "https://www.linkedin.com/in/example",
    portfolioUrl: "https://example.com",
    githubUrl: "https://github.com/example",
    workAuthorization: "Authorized to work in the United States",
    salaryTarget: 180000,
    ...overrides
  };
}

function applicationPackage(): ApplicationPackage {
  const now = new Date().toISOString();
  return {
    id: "pkg_1",
    tenantId: currentSession.tenant.id,
    userId: currentSession.userId,
    jobId: "job_1",
    applicationRecordId: "app_1",
    status: "approved",
    resumeMarkdown: "# Example User\n\nLed workflow automation launches.",
    coverLetter: "Dear hiring team,\n\nI am interested in this role.",
    generationMode: "deterministic",
    modelName: "test",
    promptVersion: "test",
    inputHash: "input",
    outputHash: "output",
    safetyWarnings: [],
    createdAt: now,
    updatedAt: now,
    approvedAt: now,
    rejectedAt: null
  };
}

function answers(): ApplicationAnswer[] {
  const now = new Date().toISOString();
  return [
    {
      id: "answer_1",
      tenantId: currentSession.tenant.id,
      userId: currentSession.userId,
      applicationPackageId: "pkg_1",
      question: "What makes you a strong fit?",
      answer: "I have verified workflow automation launch experience.",
      confidence: "high",
      source: "user_edited",
      needsUserReview: false,
      createdAt: now,
      updatedAt: now
    }
  ];
}

describe("ATS adapters", () => {
  it("detects Greenhouse-like fixtures", () => {
    const adapter = new GreenhouseATSAdapter();
    const detection = adapter.detect(greenhouseFixturePage());

    expect(detection.adapterType).toBe("greenhouse");
    expect(detection.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it("detects Lever-like fixtures", () => {
    const adapter = new LeverATSAdapter();
    const detection = adapter.detect(leverFixturePage());

    expect(detection.adapterType).toBe("lever");
    expect(detection.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it("creates a safe fill plan from profile and approved package data", () => {
    const adapter = new GreenhouseATSAdapter();
    const form = adapter.analyzeForm(greenhouseFixturePage());
    const plan = adapter.createFillPlan(profile(), applicationPackage(), form, {
      answers: answers(),
      mode: "dry_run"
    });

    expect(plan.items.length).toBeGreaterThan(0);
    expect(plan.fieldsFilled.map((field) => field.fieldId)).toContain(
      "greenhouse_first_name"
    );
    expect(plan.fieldsFilled.map((field) => field.fieldId)).toContain(
      "greenhouse_email"
    );
    expect(plan.fieldsFilled.map((field) => field.fieldId)).toContain(
      "greenhouse_resume"
    );
    expect(plan.fieldsFilled.some((field) => field.source === "application_answer")).toBe(
      true
    );
    expect(plan.fieldsFilled.every((field) => !field.valuePreview.includes("example@example.com"))).toBe(
      true
    );
  });

  it("pauses uncertain and sensitive fields by default", () => {
    const adapter = new LeverATSAdapter();
    const form = adapter.analyzeForm(leverFixturePage());
    const plan = adapter.createFillPlan(profile(), applicationPackage(), form, {
      answers: [],
      mode: "dry_run"
    });

    expect(plan.uncertainFields.map((field) => field.reason)).toContain(
      "demographic"
    );
    expect(
      plan.fieldsFilled.some((field) => field.sourceField === "demographic defaults")
    ).toBe(false);
  });

  it("does not submit from adapter infrastructure without an approved submit mode", async () => {
    const adapter = createATSBrowserAutomationAdapter();
    const now = new Date().toISOString();
    const result = await adapter.submit({
      id: "browser_1",
      tenantId: currentSession.tenant.id,
      userId: currentSession.userId,
      jobId: "job_1",
      applicationRecordId: "app_1",
      applicationPackageId: "pkg_1",
      atsType: "greenhouse",
      adapterName: "greenhouse-ats-adapter",
      adapterConfidence: 0.95,
      fillMode: "dry_run",
      status: "ready_for_review",
      fieldsDetected: [],
      fieldsFilled: [],
      uncertainFields: [],
      fillPlan: [],
      screenshotUrl: null,
      errorMessage: "",
      createdAt: now,
      updatedAt: now
    });

    expect(result.submitted).toBe(false);
    expect(result.confirmationDetected).toBe(false);
  });
});
