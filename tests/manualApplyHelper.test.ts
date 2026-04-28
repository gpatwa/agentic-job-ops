import { describe, expect, it } from "vitest";
import { currentSession } from "../src/data/currentSession";
import type {
  ApplicationAnswer,
  ApplicationPackage,
  BrowserApplicationSession,
  NormalizedJob,
  Resume,
  UserProfile
} from "../src/models/domain";
import { buildManualApplyHelper } from "../src/services/manualApplyHelper";

function fakeJob(overrides: Partial<NormalizedJob> = {}): NormalizedJob {
  const now = new Date().toISOString();
  return {
    id: "job_test",
    tenantId: currentSession.tenant.id,
    userId: currentSession.userId,
    sourceConfigId: null,
    source: "greenhouse",
    sourceJobId: "job_test",
    title: "Senior Engineering Manager",
    company: "Spring Health",
    location: "Remote",
    remoteType: "remote",
    salaryMin: null,
    salaryMax: null,
    description: "Build great mental-health software.",
    responsibilities: [],
    requirements: [],
    applicationUrl: "https://job-boards.greenhouse.io/springhealth66/jobs/4653788005",
    atsType: "greenhouse",
    postedAt: null,
    discoveredAt: now,
    scoringStatus: "scored",
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

function fakeProfile(overrides: Partial<UserProfile> = {}): UserProfile {
  const now = new Date().toISOString();
  return {
    id: "profile_test",
    tenantId: currentSession.tenant.id,
    userId: currentSession.userId,
    fullName: "Gopal Patwa",
    email: "g@example.com",
    phone: "415-302-4337",
    location: "San Francisco Bay Area",
    workAuthorization: "",
    linkedinUrl: "https://linkedin.com/in/gopalpatwa",
    portfolioUrl: "",
    githubUrl: "",
    targetTitles: ["Senior Engineering Manager"],
    targetLocations: ["Remote"],
    targetIndustries: ["B2B SaaS"],
    remotePreference: "remote",
    salaryMin: null,
    salaryTarget: null,
    companiesToAvoid: [],
    companiesToPrioritize: [],
    careerSummary: "Senior engineering leader with 20 years of experience.",
    verifiedFacts: ["Scaled team from 1 to 8"],
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

function fakeResume(): Resume {
  return {
    id: "resume_test",
    tenantId: currentSession.tenant.id,
    userId: currentSession.userId,
    originalFileName: "GopalPatwa-Resume.pdf",
    fileUrl: "test://resume",
    parsedText: "Full resume text...",
    status: "parsed",
    createdAt: new Date().toISOString()
  };
}

function fakePackage(
  overrides: Partial<ApplicationPackage> = {}
): ApplicationPackage {
  const now = new Date().toISOString();
  return {
    id: "pkg_test",
    tenantId: currentSession.tenant.id,
    userId: currentSession.userId,
    jobId: "job_test",
    applicationRecordId: "app_test",
    status: "ready_for_review",
    resumeMarkdown: "# Gopal Patwa\nTailored markdown",
    coverLetter: "",
    coverLetterIncluded: false,
    shortAnswersIncluded: false,
    generationMode: "llm",
    modelName: "openai:gpt-4.1-mini",
    promptVersion: "application-package-llm-v1",
    inputHash: "h_input",
    outputHash: "h_output",
    safetyWarnings: [],
    createdAt: now,
    updatedAt: now,
    approvedAt: null,
    rejectedAt: null,
    ...overrides
  };
}

function fakeSession(
  overrides: Partial<BrowserApplicationSession> = {}
): BrowserApplicationSession {
  const now = new Date().toISOString();
  return {
    id: "bsess_test",
    tenantId: currentSession.tenant.id,
    userId: currentSession.userId,
    applicationPackageId: "pkg_test",
    applicationRecordId: "app_test",
    jobId: "job_test",
    status: "needs_user_input",
    fillMode: "dry_run",
    atsType: "greenhouse",
    adapterName: "GreenhouseATSAdapter",
    adapterConfidence: 0.96,
    fieldsDetected: [
      {
        id: "first_name",
        label: "First Name",
        fieldType: "text",
        required: true,
        sensitive: false,
        confidence: 0.93,
        source: "profile",
        sourceField: "fullName"
      },
      {
        id: "last_name",
        label: "Last Name",
        fieldType: "text",
        required: true,
        sensitive: false,
        confidence: 0.93,
        source: "profile",
        sourceField: "fullName"
      },
      {
        id: "email",
        label: "Email",
        fieldType: "email",
        required: true,
        sensitive: false,
        confidence: 0.96,
        source: "profile",
        sourceField: "email"
      },
      {
        id: "phone",
        label: "Phone",
        fieldType: "phone",
        required: false,
        sensitive: false,
        confidence: 0.94,
        source: "profile",
        sourceField: "phone"
      },
      {
        id: "captcha",
        label: "CAPTCHA or bot challenge",
        fieldType: "captcha",
        required: true,
        sensitive: false,
        confidence: 0.1,
        source: "user_required",
        sourceField: ""
      }
    ],
    fieldsFilled: [],
    uncertainFields: [
      {
        fieldId: "captcha",
        label: "CAPTCHA or bot challenge",
        reason: "captcha",
        required: true,
        guidance: "Human action is required; the assistant will not bypass CAPTCHA."
      }
    ],
    fillPlan: [],
    screenshotUrl: null,
    errorMessage: "",
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

function fakeAnswer(
  overrides: Partial<ApplicationAnswer> = {}
): ApplicationAnswer {
  const now = new Date().toISOString();
  return {
    id: "ans_test",
    tenantId: currentSession.tenant.id,
    userId: currentSession.userId,
    applicationPackageId: "pkg_test",
    question: "Why are you interested in this role?",
    answer: "Because I love mental-health platforms.",
    confidence: "high",
    source: "generated",
    needsUserReview: false,
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

describe("buildManualApplyHelper — field assembly", () => {
  it("splits fullName into first / last name rows", () => {
    const helper = buildManualApplyHelper({
      session: fakeSession(),
      job: fakeJob(),
      profile: fakeProfile(),
      resume: fakeResume(),
      applicationPackage: fakePackage(),
      answers: []
    });
    const first = helper.fields.find((f) => f.label === "First Name");
    const last = helper.fields.find((f) => f.label === "Last Name");
    expect(first?.value).toBe("Gopal");
    expect(last?.value).toBe("Patwa");
    expect(first?.sourceLabel).toBe("profile");
  });

  it("includes email + phone with full (non-redacted) values", () => {
    const helper = buildManualApplyHelper({
      session: fakeSession(),
      job: fakeJob(),
      profile: fakeProfile(),
      resume: fakeResume(),
      applicationPackage: fakePackage(),
      answers: []
    });
    expect(helper.fields.find((f) => f.label === "Email")?.value).toBe(
      "g@example.com"
    );
    expect(helper.fields.find((f) => f.label === "Phone")?.value).toBe(
      "415-302-4337"
    );
  });

  it("excludes pause-item fields (CAPTCHA / final submit) from the row list", () => {
    const helper = buildManualApplyHelper({
      session: fakeSession(),
      job: fakeJob(),
      profile: fakeProfile(),
      resume: fakeResume(),
      applicationPackage: fakePackage(),
      answers: []
    });
    expect(
      helper.fields.find((f) => f.label === "CAPTCHA or bot challenge")
    ).toBeUndefined();
  });

  it("populates pauseItems from session.uncertainFields with the human guidance text", () => {
    const helper = buildManualApplyHelper({
      session: fakeSession(),
      job: fakeJob(),
      profile: fakeProfile(),
      resume: fakeResume(),
      applicationPackage: fakePackage(),
      answers: []
    });
    expect(helper.pauseItems).toHaveLength(1);
    expect(helper.pauseItems[0].label).toBe("CAPTCHA or bot challenge");
    expect(helper.pauseItems[0].reason).toContain("Human action is required");
  });

  it("returns null fields when the profile is empty (no fake values)", () => {
    const helper = buildManualApplyHelper({
      session: fakeSession(),
      job: fakeJob(),
      profile: fakeProfile({
        fullName: "",
        email: "",
        phone: ""
      }),
      resume: fakeResume(),
      applicationPackage: fakePackage(),
      answers: []
    });
    expect(helper.fields.find((f) => f.label === "First Name")).toBeUndefined();
    expect(helper.fields.find((f) => f.label === "Email")).toBeUndefined();
  });

  it("surfaces resumeFileName and the job's applicationUrl + jobLabel", () => {
    const helper = buildManualApplyHelper({
      session: fakeSession(),
      job: fakeJob(),
      profile: fakeProfile(),
      resume: fakeResume(),
      applicationPackage: fakePackage(),
      answers: []
    });
    expect(helper.resumeFileName).toBe("GopalPatwa-Resume.pdf");
    expect(helper.jobUrl).toBe(
      "https://job-boards.greenhouse.io/springhealth66/jobs/4653788005"
    );
    expect(helper.jobLabel).toBe("Senior Engineering Manager at Spring Health");
  });
});

describe("buildManualApplyHelper — surfaces ALL profile fields (not just session-detected)", () => {
  it("includes Location / LinkedIn / GitHub / Portfolio / Work auth from the profile when set, even if the session didn't detect them", () => {
    // The static GreenhouseATSAdapter fixture only "detects" first
    // name + last name + email + phone. The real Spring Health form
    // also has Location, LinkedIn, Website, Visa-sponsorship, etc.
    // The helper should surface every profile value regardless of
    // what the dry-run detector reported.
    const helper = buildManualApplyHelper({
      session: fakeSession({ fieldsDetected: [] }),
      job: fakeJob(),
      profile: fakeProfile({
        location: "San Francisco Bay Area",
        linkedinUrl: "https://linkedin.com/in/gopalpatwa",
        githubUrl: "https://github.com/gopalpatwa",
        portfolioUrl: "https://gopalpatwa.dev",
        workAuthorization: "US Citizen"
      }),
      resume: fakeResume(),
      applicationPackage: fakePackage(),
      answers: []
    });
    const labels = helper.fields.map((f) => f.label);
    expect(labels).toContain("Location");
    expect(labels).toContain("LinkedIn URL");
    expect(labels).toContain("GitHub URL");
    expect(labels).toContain("Portfolio / Website");
    expect(labels).toContain("Work Authorization");
    expect(helper.fields.find((f) => f.label === "LinkedIn URL")?.value).toBe(
      "https://linkedin.com/in/gopalpatwa"
    );
  });

  it("populates missingFields for empty profile fields the form likely needs", () => {
    const helper = buildManualApplyHelper({
      session: fakeSession({ fieldsDetected: [] }),
      job: fakeJob(),
      profile: fakeProfile({
        location: "San Francisco Bay Area",
        linkedinUrl: "",
        githubUrl: "",
        portfolioUrl: "",
        workAuthorization: ""
      }),
      resume: fakeResume(),
      applicationPackage: fakePackage(),
      answers: []
    });
    const missingLabels = helper.missingFields.map((m) => m.label);
    expect(missingLabels).toContain("LinkedIn URL");
    expect(missingLabels).toContain("GitHub URL");
    expect(missingLabels).toContain("Work Authorization");
    expect(helper.missingFields.every((m) => m.guidance.length > 0)).toBe(true);
  });

  it("does not list a profile field in BOTH fields and missingFields", () => {
    const helper = buildManualApplyHelper({
      session: fakeSession({ fieldsDetected: [] }),
      job: fakeJob(),
      profile: fakeProfile({
        linkedinUrl: "https://linkedin.com/in/gopalpatwa"
      }),
      resume: fakeResume(),
      applicationPackage: fakePackage(),
      answers: []
    });
    expect(helper.fields.find((f) => f.label === "LinkedIn URL")).toBeDefined();
    expect(
      helper.missingFields.find((m) => m.label === "LinkedIn URL")
    ).toBeUndefined();
  });
});

describe("buildManualApplyHelper — copyAllText", () => {
  it("includes every field, the cover letter, and short answers as a single text block", () => {
    const helper = buildManualApplyHelper({
      session: fakeSession({ fieldsDetected: [] }),
      job: fakeJob(),
      profile: fakeProfile({
        location: "San Francisco Bay Area",
        linkedinUrl: "https://linkedin.com/in/gopalpatwa"
      }),
      resume: fakeResume(),
      applicationPackage: fakePackage({
        coverLetterIncluded: true,
        coverLetter: "Dear hiring team,\n\nI am interested.",
        shortAnswersIncluded: true
      }),
      answers: [
        fakeAnswer({
          question: "Why this role?",
          answer: "Aligned with my data-platform leadership experience."
        })
      ]
    });
    const text = helper.copyAllText;
    expect(text).toContain("Senior Engineering Manager at Spring Health");
    expect(text).toContain(
      "Application URL: https://job-boards.greenhouse.io/springhealth66/jobs/4653788005"
    );
    expect(text).toContain("Resume to upload: GopalPatwa-Resume.pdf");
    expect(text).toContain("First Name: Gopal");
    expect(text).toContain("Last Name: Patwa");
    expect(text).toContain("Location: San Francisco Bay Area");
    expect(text).toContain("LinkedIn URL: https://linkedin.com/in/gopalpatwa");
    expect(text).toContain("## Cover letter");
    expect(text).toContain("Dear hiring team");
    expect(text).toContain("## Short answers");
    expect(text).toContain("Q: Why this role?");
    expect(text).toContain("A: Aligned with my data-platform leadership experience.");
  });

  it("omits the cover-letter section when the package opted out", () => {
    const helper = buildManualApplyHelper({
      session: fakeSession({ fieldsDetected: [] }),
      job: fakeJob(),
      profile: fakeProfile(),
      resume: fakeResume(),
      applicationPackage: fakePackage({ coverLetterIncluded: false }),
      answers: []
    });
    expect(helper.copyAllText).not.toContain("## Cover letter");
  });

  it("omits the short-answers section when the package opted out", () => {
    const helper = buildManualApplyHelper({
      session: fakeSession({ fieldsDetected: [] }),
      job: fakeJob(),
      profile: fakeProfile(),
      resume: fakeResume(),
      applicationPackage: fakePackage({ shortAnswersIncluded: false }),
      answers: [fakeAnswer()]
    });
    expect(helper.copyAllText).not.toContain("## Short answers");
  });
});

describe("buildManualApplyHelper — opt-in gates", () => {
  it("returns empty cover letter when the package opted out", () => {
    const helper = buildManualApplyHelper({
      session: fakeSession(),
      job: fakeJob(),
      profile: fakeProfile(),
      resume: fakeResume(),
      applicationPackage: fakePackage({
        coverLetterIncluded: false,
        coverLetter: "Some text that should be IGNORED"
      }),
      answers: []
    });
    expect(helper.coverLetter).toBeNull();
  });

  it("returns the cover letter when the package opted in", () => {
    const helper = buildManualApplyHelper({
      session: fakeSession(),
      job: fakeJob(),
      profile: fakeProfile(),
      resume: fakeResume(),
      applicationPackage: fakePackage({
        coverLetterIncluded: true,
        coverLetter: "Dear hiring team..."
      }),
      answers: []
    });
    expect(helper.coverLetter).toBe("Dear hiring team...");
  });

  it("returns empty short answers when the package opted out (even if answers exist)", () => {
    const helper = buildManualApplyHelper({
      session: fakeSession(),
      job: fakeJob(),
      profile: fakeProfile(),
      resume: fakeResume(),
      applicationPackage: fakePackage({ shortAnswersIncluded: false }),
      answers: [fakeAnswer()]
    });
    expect(helper.shortAnswers).toEqual([]);
  });

  it("returns short answers + flags fromLibrary on saved_library source", () => {
    const helper = buildManualApplyHelper({
      session: fakeSession(),
      job: fakeJob(),
      profile: fakeProfile(),
      resume: fakeResume(),
      applicationPackage: fakePackage({ shortAnswersIncluded: true }),
      answers: [
        fakeAnswer({
          id: "ans_1",
          question: "Why this company?",
          answer: "Mental-health technology aligns with my values.",
          source: "saved_library"
        }),
        fakeAnswer({
          id: "ans_2",
          question: "Why this role?",
          answer: "Generated draft answer.",
          source: "generated"
        })
      ]
    });
    expect(helper.shortAnswers).toHaveLength(2);
    const fromLibrary = helper.shortAnswers.find(
      (qa) => qa.question === "Why this company?"
    );
    const generated = helper.shortAnswers.find(
      (qa) => qa.question === "Why this role?"
    );
    expect(fromLibrary?.fromLibrary).toBe(true);
    expect(generated?.fromLibrary).toBe(false);
  });
});
