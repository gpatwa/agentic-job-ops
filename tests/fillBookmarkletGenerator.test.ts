import { describe, expect, it } from "vitest";
import { currentSession } from "../src/data/currentSession";
import type {
  ApplicationPackage,
  NormalizedJob,
  UserProfile
} from "../src/models/domain";
import {
  countFillableSlots,
  FILL_SCRIPT_TEMPLATE,
  generateFillBookmarklet
} from "../src/services/fillBookmarkletGenerator";

function fakeProfile(overrides: Partial<UserProfile> = {}): UserProfile {
  const now = new Date().toISOString();
  return {
    id: "p1",
    tenantId: currentSession.tenant.id,
    userId: currentSession.userId,
    fullName: "Gopal Patwa",
    email: "g@example.com",
    phone: "415-302-4337",
    location: "San Francisco Bay Area",
    workAuthorization: "US Citizen",
    linkedinUrl: "https://linkedin.com/in/gopalpatwa",
    portfolioUrl: "",
    githubUrl: "",
    targetTitles: [],
    targetLocations: [],
    targetIndustries: [],
    remotePreference: "remote",
    salaryMin: null,
    salaryTarget: null,
    companiesToAvoid: [],
    companiesToPrioritize: [],
    careerSummary: "",
    verifiedFacts: [],
    visaSponsorshipNeeded: "",
    howDidYouHearAboutUs: "",
    genderIdentity: "",
    raceEthnicity: "",
    veteranStatus: "",
    disabilityStatus: "",
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

function fakeJob(overrides: Partial<NormalizedJob> = {}): NormalizedJob {
  const now = new Date().toISOString();
  return {
    id: "j1",
    tenantId: currentSession.tenant.id,
    userId: currentSession.userId,
    sourceConfigId: null,
    source: "greenhouse",
    sourceJobId: "j1",
    title: "Senior Engineer",
    company: "Spring Health",
    location: "Remote",
    remoteType: "remote",
    salaryMin: null,
    salaryMax: null,
    description: "",
    responsibilities: [],
    requirements: [],
    applicationUrl:
      "https://job-boards.greenhouse.io/springhealth66/jobs/4653788005",
    atsType: "greenhouse",
    postedAt: null,
    discoveredAt: now,
    scoringStatus: "scored",
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

function fakePackage(
  overrides: Partial<ApplicationPackage> = {}
): ApplicationPackage {
  const now = new Date().toISOString();
  return {
    id: "pkg1",
    tenantId: currentSession.tenant.id,
    userId: currentSession.userId,
    jobId: "j1",
    applicationRecordId: "app1",
    status: "ready_for_review",
    resumeMarkdown: "",
    coverLetter: "",
    coverLetterIncluded: false,
    shortAnswersIncluded: false,
    generationMode: "llm",
    modelName: "openai:gpt-4.1-mini",
    promptVersion: "application-package-llm-v1",
    inputHash: "h",
    outputHash: "h",
    safetyWarnings: [],
    createdAt: now,
    updatedAt: now,
    approvedAt: null,
    rejectedAt: null,
    ...overrides
  };
}

describe("generateFillBookmarklet", () => {
  it("returns a `javascript:` URI containing the encoded script template", () => {
    const href = generateFillBookmarklet({
      profile: fakeProfile(),
      applicationPackage: fakePackage(),
      answers: [],
      job: fakeJob()
    });
    expect(href.startsWith("javascript:")).toBe(true);
    // The script body is URI-encoded; decoding should bring back the
    // "filledCount" string we wrote in the template.
    const decoded = decodeURIComponent(href.slice("javascript:".length));
    expect(decoded).toContain("filledCount");
    // Profile values are inlined as JSON inside the script.
    expect(decoded).toContain("Gopal");
    expect(decoded).toContain("g@example.com");
    expect(decoded).toContain("415-302-4337");
  });

  it("inlines a Greenhouse-flavored selector map (first_name, last_name, email, phone)", () => {
    const href = generateFillBookmarklet({
      profile: fakeProfile(),
      applicationPackage: fakePackage(),
      answers: [],
      job: fakeJob()
    });
    const decoded = decodeURIComponent(href.slice("javascript:".length));
    expect(decoded).toContain("#first_name");
    expect(decoded).toContain("#last_name");
    expect(decoded).toContain("#email");
    expect(decoded).toContain("#phone");
  });

  it("never references `.click()` (no auto-submit, by construction)", () => {
    // Our human-gate rule says we never auto-submit. The bookmarklet
    // proves this structurally: the generated script has no .click()
    // call anywhere — there's no way for the script to press the
    // form's Submit button.
    const href = generateFillBookmarklet({
      profile: fakeProfile(),
      applicationPackage: fakePackage({
        coverLetterIncluded: true,
        coverLetter: "Dear hiring team",
        shortAnswersIncluded: true
      }),
      answers: [],
      job: fakeJob()
    });
    const decoded = decodeURIComponent(href.slice("javascript:".length));
    expect(decoded).not.toMatch(/\.click\s*\(/);
    // Same goes for `submit()`. Native `form.submit()` would also bypass
    // human review.
    expect(decoded).not.toMatch(/\.submit\s*\(/);
  });

  it("uses the React-aware native value setter so React-controlled forms update their state", () => {
    // Greenhouse, Lever, and many ATS forms are React apps. Setting
    // input.value = "X" directly does NOT trigger their onChange. We
    // call the native HTMLInputElement prototype setter then dispatch
    // an 'input' event — same pattern Cypress + 1Password use.
    expect(FILL_SCRIPT_TEMPLATE).toContain("HTMLInputElement.prototype");
    expect(FILL_SCRIPT_TEMPLATE).toContain('dispatchEvent(new Event("input"');
  });

  it("includes saved short answers ONLY when the package opted in", () => {
    const optedOut = decodeURIComponent(
      generateFillBookmarklet({
        profile: fakeProfile(),
        applicationPackage: fakePackage({ shortAnswersIncluded: false }),
        answers: [
          {
            id: "a1",
            tenantId: currentSession.tenant.id,
            userId: currentSession.userId,
            applicationPackageId: "pkg1",
            question: "Why?",
            answer: "Because.",
            confidence: "high",
            source: "generated",
            needsUserReview: false,
            createdAt: "2026-01-01T00:00:00Z",
            updatedAt: "2026-01-01T00:00:00Z"
          }
        ],
        job: fakeJob()
      }).slice("javascript:".length)
    );
    expect(optedOut).not.toContain("Because.");

    const optedIn = decodeURIComponent(
      generateFillBookmarklet({
        profile: fakeProfile(),
        applicationPackage: fakePackage({ shortAnswersIncluded: true }),
        answers: [
          {
            id: "a1",
            tenantId: currentSession.tenant.id,
            userId: currentSession.userId,
            applicationPackageId: "pkg1",
            question: "Why?",
            answer: "Because.",
            confidence: "high",
            source: "generated",
            needsUserReview: false,
            createdAt: "2026-01-01T00:00:00Z",
            updatedAt: "2026-01-01T00:00:00Z"
          }
        ],
        job: fakeJob()
      }).slice("javascript:".length)
    );
    expect(optedIn).toContain("Because.");
  });
});

describe("countFillableSlots", () => {
  it("counts profile fields with non-empty values + opted-in short answers", () => {
    expect(
      countFillableSlots({
        profile: fakeProfile({
          // 5 standard fields filled
          fullName: "Gopal Patwa",
          email: "g@example.com",
          phone: "415-302-4337",
          location: "Remote",
          linkedinUrl: "https://linkedin.com/in/gopalpatwa",
          // empty
          githubUrl: "",
          portfolioUrl: "",
          workAuthorization: "",
          visaSponsorshipNeeded: "",
          howDidYouHearAboutUs: "",
          genderIdentity: "",
          raceEthnicity: "",
          veteranStatus: "",
          disabilityStatus: ""
        }),
        applicationPackage: fakePackage({ shortAnswersIncluded: false }),
        answers: [],
        job: fakeJob()
      })
    ).toBeGreaterThanOrEqual(5);
  });

  it("returns 0 when the profile is empty", () => {
    expect(
      countFillableSlots({
        profile: fakeProfile({
          fullName: "",
          email: "",
          phone: "",
          location: "",
          linkedinUrl: "",
          githubUrl: "",
          portfolioUrl: "",
          workAuthorization: "",
          visaSponsorshipNeeded: "",
          howDidYouHearAboutUs: "",
          genderIdentity: "",
          raceEthnicity: "",
          veteranStatus: "",
          disabilityStatus: ""
        }),
        applicationPackage: fakePackage({ shortAnswersIncluded: false }),
        answers: [],
        job: fakeJob()
      })
    ).toBe(0);
  });

  it("returns null profile as zero", () => {
    expect(
      countFillableSlots({
        profile: null,
        applicationPackage: fakePackage(),
        answers: [],
        job: fakeJob()
      })
    ).toBe(0);
  });
});
