import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { currentSession } from "../src/data/currentSession";
import type { NormalizedJob, Resume, UserProfile } from "../src/models/domain";
import {
  approveApplicationPackage,
  checkUnsupportedClaims,
  generateApplicationPackage,
  loadApplicationAnswers,
  loadApplicationPackages,
  updateApplicationAnswerDraft
} from "../src/services/applicationPackage";
import { applyDashboardJobAction } from "../src/services/applicationWorkflow";
import { createEmptyProfile } from "../src/services/profileService";
import {
  findSavedAnswer,
  loadSavedAnswers
} from "../src/services/savedAnswerLibrary";

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
  return {
    ...createEmptyProfile(currentSession),
    fullName: "Example User",
    email: "example@example.com",
    location: "Remote",
    workAuthorization: "Authorized",
    targetTitles: ["Staff Product Manager"],
    targetLocations: ["Remote"],
    targetIndustries: ["B2B SaaS"],
    remotePreference: "remote",
    careerSummary:
      "Product leader focused on B2B SaaS workflow automation and customer discovery.",
    verifiedFacts: [
      "Led B2B SaaS workflow automation launches",
      "Partnered with engineering and design on customer discovery"
    ],
    ...overrides
  };
}

function resume(overrides: Partial<Resume> = {}): Resume {
  const now = new Date().toISOString();

  return {
    id: "resume_1",
    tenantId: currentSession.tenant.id,
    userId: currentSession.userId,
    originalFileName: "resume.pdf",
    fileUrl: "local-placeholder://resume.pdf",
    parsedText:
      "Example User led B2B SaaS workflow automation launches and partnered with engineering, design, and go-to-market teams.",
    status: "parsed",
    createdAt: now,
    ...overrides
  };
}

function job(overrides: Partial<NormalizedJob> = {}): NormalizedJob {
  const now = new Date().toISOString();

  return {
    id: "job_1",
    tenantId: currentSession.tenant.id,
    userId: currentSession.userId,
    sourceConfigId: "source_1",
    source: "lever",
    sourceJobId: "lever_123",
    title: "Staff Product Manager",
    company: "ExampleCo",
    location: "Remote",
    remoteType: "remote",
    salaryMin: 160000,
    salaryMax: 190000,
    description:
      "ExampleCo is hiring a Staff Product Manager for B2B SaaS workflow automation, customer discovery, and cross-functional execution.",
    responsibilities: [
      "Lead customer discovery",
      "Partner with engineering and design on roadmap delivery"
    ],
    requirements: [
      "B2B SaaS product experience",
      "Experience launching workflow automation"
    ],
    applicationUrl: "https://example.com/jobs/123",
    atsType: "lever",
    postedAt: now,
    discoveredAt: now,
    scoringStatus: "scored",
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

describe("application package generation", () => {
  beforeEach(() => {
    installLocalStorageMock();
  });

  afterEach(() => {
    Reflect.deleteProperty(globalThis, "window");
  });

  it("generates a reviewable deterministic package with default opt-out for both cover letter + short answers", async () => {
    const workflow = applyDashboardJobAction(
      currentSession,
      "job_1",
      "start_application_prep"
    );

    const result = await generateApplicationPackage({
      session: currentSession,
      application: workflow.application,
      profile: profile(),
      resume: resume(),
      job: job(),
      match: null
    });

    expect(result.package.status).toBe("ready_for_review");
    expect(result.package.generationMode).toBe("deterministic");
    expect(result.package.tenantId).toBe(currentSession.tenant.id);
    expect(result.package.userId).toBe(currentSession.userId);
    expect(result.package.applicationRecordId).toBe(workflow.application.id);
    expect(result.package.resumeMarkdown).toContain("Staff Product Manager");
    // Cover letter + short answers are opt-out by default (Phase-4
    // UX change). The deterministic generator returns "" / [] and
    // the package flags stay false. The page UI hides the editors
    // until the user clicks the per-section "Generate" button.
    expect(result.package.coverLetter).toBe("");
    expect(result.package.coverLetterIncluded).toBe(false);
    expect(result.package.shortAnswersIncluded).toBe(false);
    expect(result.answers).toHaveLength(0);
    expect(loadApplicationPackages(currentSession)).toHaveLength(1);
    expect(loadApplicationAnswers(currentSession)).toHaveLength(0);
  });

  it("generates short-answer drafts when includeShortAnswers is true", async () => {
    const workflow = applyDashboardJobAction(
      currentSession,
      "job_1",
      "start_application_prep"
    );
    const result = await generateApplicationPackage({
      session: currentSession,
      application: workflow.application,
      profile: profile(),
      resume: resume(),
      job: job(),
      match: null,
      includeShortAnswers: true
    });
    expect(result.package.shortAnswersIncluded).toBe(true);
    expect(result.answers).toHaveLength(4);
    expect(result.answers[0].source).toBe("generated");
  });

  it("upserts saved-library entries on user-edited save and reuses them on the next package", async () => {
    // First application: opt in to short answers, edit one, save —
    // upsertSavedAnswer fires from inside updateApplicationAnswerDraft.
    const workflow = applyDashboardJobAction(
      currentSession,
      "job_1",
      "start_application_prep"
    );
    const generated = await generateApplicationPackage({
      session: currentSession,
      application: workflow.application,
      profile: profile(),
      resume: resume(),
      job: job(),
      match: null,
      includeShortAnswers: true
    });
    expect(generated.answers).toHaveLength(4);

    // Edit + save the first answer.
    const edited = updateApplicationAnswerDraft(
      currentSession,
      generated.answers[0].id,
      "My polished, reusable answer for why-this-role.",
      {
        profile: profile(),
        resume: resume(),
        job: job(),
        match: null
      }
    );
    expect(edited.package.id).toBe(generated.package.id);

    // Library should have one entry now.
    const library = loadSavedAnswers(currentSession);
    expect(library).toHaveLength(1);
    expect(library[0].answer).toBe(
      "My polished, reusable answer for why-this-role."
    );

    // Direct lookup by question text works (case-insensitive).
    expect(
      findSavedAnswer(currentSession, "Why are you interested in this role?")
    ).not.toBeNull();

    // Second application — generate a fresh package and confirm
    // the matching question is filled from the library, NOT from
    // a fresh generator call.
    const secondWorkflow = applyDashboardJobAction(
      currentSession,
      "job_2",
      "start_application_prep"
    );
    const second = await generateApplicationPackage({
      session: currentSession,
      application: secondWorkflow.application,
      profile: profile(),
      resume: resume(),
      job: job({ id: "job_2", title: "Director of Product, NewCo" }),
      match: null,
      includeShortAnswers: true
    });
    const reusedAnswer = second.answers.find(
      (answer) => answer.question === "Why are you interested in this role?"
    )!;
    expect(reusedAnswer.source).toBe("saved_library");
    expect(reusedAnswer.answer).toBe(
      "My polished, reusable answer for why-this-role."
    );
    // Other questions still come from the deterministic generator.
    const otherAnswer = second.answers.find(
      (answer) => answer.question === "What makes you a strong fit?"
    )!;
    expect(otherAnswer.source).toBe("generated");
  });

  it("opts in to a cover letter when includeCoverLetter is true", async () => {
    const workflow = applyDashboardJobAction(
      currentSession,
      "job_1",
      "start_application_prep"
    );
    const result = await generateApplicationPackage({
      session: currentSession,
      application: workflow.application,
      profile: profile(),
      resume: resume(),
      job: job(),
      match: null,
      includeCoverLetter: true
    });
    expect(result.package.coverLetterIncluded).toBe(true);
    expect(result.package.coverLetter).toContain("ExampleCo");
    expect(result.package.coverLetter).toContain("Dear hiring team");
  });

  it("preserves coverLetterIncluded across re-generation when the caller doesn't override it", async () => {
    const workflow = applyDashboardJobAction(
      currentSession,
      "job_1",
      "start_application_prep"
    );
    // Initial generation — opted IN.
    await generateApplicationPackage({
      session: currentSession,
      application: workflow.application,
      profile: profile(),
      resume: resume(),
      job: job(),
      match: null,
      includeCoverLetter: true
    });
    // Re-generate without specifying includeCoverLetter — should
    // inherit the existing package's true flag.
    const result = await generateApplicationPackage({
      session: currentSession,
      application: workflow.application,
      profile: profile(),
      resume: resume(),
      job: job(),
      match: null
    });
    expect(result.package.coverLetterIncluded).toBe(true);
    // Deterministic generator only produces a cover letter when
    // includeCoverLetter is set on the request, NOT based on the
    // existing package flag — so the regeneration produces "" and
    // the persisted package keeps the empty value. The user-facing
    // expectation is: coverLetterIncluded persists, cover-letter
    // text is regenerated only when explicitly requested.
    // (When wired through the UI, the regenerate action always
    // passes includeCoverLetter: true.)
    expect(typeof result.package.coverLetter).toBe("string");
  });

  it("flags unsupported companies, tools, credentials, and unverified metrics", () => {
    const warnings = checkUnsupportedClaims({
      text:
        "I led Google Kubernetes work, earned AWS Certified credentials, and improved conversion by 40%.",
      profile: profile({ verifiedFacts: ["Led workflow automation launches"] }),
      resume: null,
      job: job({ description: "ExampleCo needs customer discovery." })
    });

    expect(warnings).toContain("Unsupported company mention: Google");
    expect(warnings).toContain("Unsupported tool mention: Kubernetes");
    expect(warnings).toContain("Unsupported degree or certification mention: AWS Certified");
    expect(warnings).toContain("Metric needs verification before use: 40%");
  });

  it("marks edited answers as user edited and refreshes package warnings", async () => {
    const workflow = applyDashboardJobAction(
      currentSession,
      "job_1",
      "start_application_prep"
    );
    const generated = await generateApplicationPackage({
      session: currentSession,
      application: workflow.application,
      profile: profile(),
      resume: resume(),
      job: job(),
      match: null,
      // Need short answers for the edit assertion below.
      includeShortAnswers: true
    });

    const result = updateApplicationAnswerDraft(
      currentSession,
      generated.answers[0].id,
      "I worked at Google on Kubernetes.",
      {
        profile: profile(),
        resume: resume(),
        job: job(),
        match: null
      }
    );

    const edited = result.answers.find((answer) => answer.id === generated.answers[0].id);
    expect(edited?.source).toBe("user_edited");
    expect(edited?.needsUserReview).toBe(false);
    expect(result.package.safetyWarnings).toContain(
      "Unsupported company mention: Google"
    );
    expect(result.package.safetyWarnings).toContain(
      "Unsupported tool mention: Kubernetes"
    );
  });

  it("approves a package and moves the application record to approved", async () => {
    const workflow = applyDashboardJobAction(
      currentSession,
      "job_1",
      "start_application_prep"
    );
    const generated = await generateApplicationPackage({
      session: currentSession,
      application: workflow.application,
      profile: profile(),
      resume: resume(),
      job: job(),
      match: null
    });

    const result = approveApplicationPackage(currentSession, generated.package.id);

    expect(result.package.status).toBe("approved");
    expect(result.package.approvedAt).not.toBeNull();
    expect(result.application.status).toBe("approved");
  });
});
