import { describe, expect, it } from "vitest";
import type {
  ApplicationAnswer,
  ApplicationPackage,
  BrowserApplicationSession,
  UserProfile
} from "../src/models/domain";
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
    coverLetterIncluded: true,
    shortAnswersIncluded: true,
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

  it("never reports submitted from executeFillPlan in dry_run or fill_only", () => {
    const adapter = new GreenhouseATSAdapter();
    const page = greenhouseFixturePage();
    const form = adapter.analyzeForm(page);
    const plan = adapter.createFillPlan(profile(), applicationPackage(), form, {
      answers: answers(),
      mode: "dry_run"
    });

    const dryRun = adapter.executeFillPlan(page, plan, "dry_run");
    expect(dryRun.submitted).toBe(false);
    expect(dryRun.mode).toBe("dry_run");

    const fillOnly = adapter.executeFillPlan(page, plan, "fill_only");
    expect(fillOnly.submitted).toBe(false);
    expect(fillOnly.mode).toBe("fill_only");
  });

  it("blocks submitAfterApproval when fillMode is dry_run", () => {
    const adapter = new GreenhouseATSAdapter();
    const session: BrowserApplicationSession = makeSession({ fillMode: "dry_run" });
    const result = adapter.submitAfterApproval(greenhouseFixturePage(), session);
    expect(result.submitted).toBe(false);
    expect(result.message).toContain("fill mode");
  });

  it("blocks submitAfterApproval when status is not approved_for_submit", () => {
    const adapter = new GreenhouseATSAdapter();
    const session: BrowserApplicationSession = makeSession({
      status: "ready_for_review",
      fillMode: "submit_after_approval"
    });
    const result = adapter.submitAfterApproval(greenhouseFixturePage(), session);
    expect(result.submitted).toBe(false);
    expect(result.message).toContain("session status");
  });

  it("blocks submitAfterApproval against non-fixture pages even when status and mode are correct", () => {
    const adapter = new GreenhouseATSAdapter();
    const session: BrowserApplicationSession = makeSession({
      status: "approved_for_submit",
      fillMode: "submit_after_approval"
    });
    const result = adapter.submitAfterApproval(
      { url: "https://boards.greenhouse.io/example/jobs/123", html: "<form></form>" },
      session
    );
    expect(result.submitted).toBe(false);
    expect(result.message).toContain("live external submit is disabled");
  });

  it("never marks demographic fields as filled, regardless of profile data", () => {
    const adapter = new GreenhouseATSAdapter();
    const form = adapter.analyzeForm(greenhouseFixturePage());
    const plan = adapter.createFillPlan(profile(), applicationPackage(), form, {
      answers: answers(),
      mode: "dry_run"
    });

    expect(
      plan.fieldsFilled.some(
        (field) =>
          field.sourceField === "demographic defaults" ||
          field.label.toLowerCase().includes("gender") ||
          field.label.toLowerCase().includes("veteran")
      )
    ).toBe(false);
    expect(
      plan.uncertainFields.some((field) => field.reason === "demographic")
    ).toBe(true);
  });

  it("pauses salary fields when no salary preference is set on the profile", () => {
    const adapter = new GreenhouseATSAdapter();
    const page = {
      url: "https://boards.greenhouse.io/example/jobs/789",
      html: `
        <form id="application_form">
          <label for="first_name">First Name</label>
          <input id="first_name" name="job_application[first_name]" required />
          <label for="email">Email</label>
          <input id="email" name="job_application[email]" type="email" required />
          <label for="salary">Salary expectations</label>
          <input id="salary" name="job_application[salary_expectations]" required />
        </form>
      `,
      title: "Greenhouse fixture with salary",
      safeFixture: true
    };
    const form = adapter.analyzeForm(page);
    const plan = adapter.createFillPlan(
      profile({ salaryTarget: null, salaryMin: null }),
      applicationPackage(),
      form,
      { answers: [], mode: "dry_run" }
    );

    expect(
      plan.fieldsFilled.some((field) =>
        field.label.toLowerCase().includes("salary")
      )
    ).toBe(false);
    expect(
      plan.uncertainFields.some((field) => field.reason === "salary_missing")
    ).toBe(true);
  });
});

function makeSession(
  overrides: Partial<BrowserApplicationSession> = {}
): BrowserApplicationSession {
  const now = new Date().toISOString();
  return {
    id: "browser_1",
    tenantId: currentSession.tenant.id,
    userId: currentSession.userId,
    jobId: "job_1",
    applicationRecordId: "app_1",
    applicationPackageId: "pkg_1",
    atsType: "greenhouse",
    adapterName: "greenhouse-ats-adapter",
    adapterConfidence: 0.95,
    fillMode: "submit_after_approval",
    status: "approved_for_submit",
    fieldsDetected: [],
    fieldsFilled: [],
    uncertainFields: [],
    fillPlan: [],
    screenshotUrl: null,
    errorMessage: "",
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}
