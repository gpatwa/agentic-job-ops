import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { currentSession } from "../src/data/currentSession";
import type {
  ApplicationRecord,
  NormalizedJob,
  RecruiterContact,
  UserProfile
} from "../src/models/domain";
import {
  PlaceholderLlmOutreachAdapter,
  addInterviewNote,
  addRecruiterContact,
  createFollowUpReminder,
  crmForApplication,
  dueRemindersToday,
  generateOutreachDraft,
  loadFollowUpReminders,
  loadOutreachDrafts,
  updateFollowUpReminder,
  updateOutreachDraft
} from "../src/services/recruiterCrmService";
import { userProfileSchema } from "../src/models/schemas";

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
    targetIndustries: ["B2B SaaS"],
    remotePreference: "remote",
    salaryMin: 150000,
    salaryTarget: 180000,
    companiesToAvoid: [],
    companiesToPrioritize: ["ExampleCo"],
    careerSummary: "Product leader focused on workflow automation.",
    verifiedFacts: ["Led B2B SaaS launches"],
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides
  });
}

function job(overrides: Partial<NormalizedJob> = {}): NormalizedJob {
  const now = new Date().toISOString();
  return {
    id: "job_crm_test",
    tenantId: currentSession.tenant.id,
    userId: currentSession.userId,
    sourceConfigId: null,
    source: "greenhouse",
    sourceJobId: "test_crm",
    title: "Staff Product Manager",
    company: "ExampleCo",
    location: "Remote",
    remoteType: "remote",
    salaryMin: 170000,
    salaryMax: 210000,
    description:
      "ExampleCo is hiring a Staff PM for B2B SaaS workflow automation.",
    responsibilities: ["Lead discovery"],
    requirements: ["B2B SaaS PM experience"],
    applicationUrl: "https://boards.greenhouse.io/example/jobs/1",
    atsType: "greenhouse",
    postedAt: now,
    discoveredAt: now,
    scoringStatus: "queued",
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

function application(
  overrides: Partial<ApplicationRecord> = {}
): ApplicationRecord {
  const now = new Date().toISOString();
  return {
    id: "app_crm_test",
    tenantId: currentSession.tenant.id,
    userId: currentSession.userId,
    jobId: "job_crm_test",
    status: "approved",
    notes: "",
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

beforeEach(() => {
  installLocalStorageMock();
});

afterEach(() => {
  // Reset window between tests so each suite gets a clean store.
  // @ts-expect-error allow re-installing the mock
  delete globalThis.window;
});

describe("recruiterCrmService — outreach safety gates", () => {
  it("uses generic 'Hi team' salutation when no recruiter contact is provided", async () => {
    const result = await generateOutreachDraft(currentSession, {
      type: "recruiter_intro",
      job: job(),
      application: application(),
      recruiterContact: null,
      profile: profile(),
      intelligence: null,
      interviewNotes: []
    });
    expect(result.draft.body).toContain("Hi team");
    expect(result.draft.body).not.toMatch(/Hi [A-Z][a-z]+,/);
    expect(result.draft.status).toBe("draft");
    expect(result.draft.approvedAt).toBeNull();
    expect(result.draft.sentManuallyAt).toBeNull();
  });

  it("rejects thank-you drafts without an interview note or interviewing/offer status", async () => {
    await expect(
      generateOutreachDraft(currentSession, {
        type: "thank_you",
        job: job(),
        application: application({ status: "submitted" }),
        recruiterContact: null,
        profile: profile(),
        intelligence: null,
        interviewNotes: []
      })
    ).rejects.toThrow(/interview/i);
  });

  it("allows thank-you drafts when an interview note exists", async () => {
    const result = await generateOutreachDraft(currentSession, {
      type: "thank_you",
      job: job(),
      application: application({ status: "interviewing" }),
      recruiterContact: null,
      profile: profile(),
      intelligence: null,
      interviewNotes: [
        {
          id: "note_test",
          tenantId: currentSession.tenant.id,
          userId: currentSession.userId,
          jobId: "job_crm_test",
          applicationRecordId: "app_crm_test",
          stage: "hiring_manager",
          scheduledAt: null,
          interviewerNames: ["Jordan"],
          notes: "We discussed the customer discovery process in depth.",
          questionsAsked: [],
          followUps: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      ]
    });
    expect(result.draft.subject.toLowerCase()).toContain("thank you");
    expect(result.draft.body.toLowerCase()).toContain("hiring manager");
  });

  it("rejects negotiation drafts unless application is in offer status", async () => {
    await expect(
      generateOutreachDraft(currentSession, {
        type: "negotiation",
        job: job(),
        application: application({ status: "interviewing" }),
        recruiterContact: null,
        profile: profile(),
        intelligence: null,
        interviewNotes: []
      })
    ).rejects.toThrow(/interviewing/);
  });

  it("rejects follow-up drafts when application is still in saved status", async () => {
    await expect(
      generateOutreachDraft(currentSession, {
        type: "follow_up",
        job: job(),
        application: application({ status: "saved" }),
        recruiterContact: null,
        profile: profile(),
        intelligence: null,
        interviewNotes: []
      })
    ).rejects.toThrow(/saved/);
  });

  it("records safetyOverride in audit metadata when caller passes overrideSafetyGate", async () => {
    const result = await generateOutreachDraft(currentSession, {
      type: "thank_you",
      job: job(),
      application: application({ status: "submitted" }),
      recruiterContact: null,
      profile: profile(),
      intelligence: null,
      interviewNotes: [],
      overrideSafetyGate: true
    });
    const event = result.auditEvents.find(
      (item) => item.action === "outreach_draft_generated"
    );
    expect(event?.metadata.safetyOverride).toBe("true");
  });
});

describe("recruiterCrmService — drafts never auto-send", () => {
  it("approve and sent_manually transitions only happen via explicit update", async () => {
    const result = await generateOutreachDraft(currentSession, {
      type: "recruiter_intro",
      job: job(),
      application: application(),
      recruiterContact: null,
      profile: profile(),
      intelligence: null,
      interviewNotes: []
    });
    expect(result.draft.status).toBe("draft");
    const approved = updateOutreachDraft(currentSession, {
      id: result.draft.id,
      status: "approved"
    });
    expect(approved.draft.status).toBe("approved");
    expect(approved.draft.approvedAt).not.toBeNull();
    const sent = updateOutreachDraft(currentSession, {
      id: result.draft.id,
      status: "sent_manually"
    });
    expect(sent.draft.status).toBe("sent_manually");
    expect(sent.draft.sentManuallyAt).not.toBeNull();
  });
});

describe("recruiterCrmService — never invent recruiter names", () => {
  it("addRecruiterContact preserves empty name (no fabrication)", () => {
    const result = addRecruiterContact(currentSession, {
      jobId: "job_crm_test",
      applicationRecordId: "app_crm_test",
      company: "ExampleCo"
    });
    expect(result.contact.name).toBe("");
    expect(result.contact.source).toBe("user_entered");
  });

  it("intro draft uses provided contact's first name only when valid", async () => {
    const contact: RecruiterContact = {
      id: "contact_test",
      tenantId: currentSession.tenant.id,
      userId: currentSession.userId,
      jobId: "job_crm_test",
      applicationRecordId: "app_crm_test",
      company: "ExampleCo",
      name: "Jordan Smith",
      title: "Recruiter",
      email: "",
      publicProfileUrl: "",
      source: "user_entered",
      confidence: "high",
      notes: "",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const result = await generateOutreachDraft(currentSession, {
      type: "recruiter_intro",
      job: job(),
      application: application(),
      recruiterContact: contact,
      profile: profile(),
      intelligence: null,
      interviewNotes: []
    });
    expect(result.draft.body).toContain("Hi Jordan");
    expect(result.draft.body).not.toContain("Smith");
  });
});

describe("recruiterCrmService — placeholder LLM adapter", () => {
  it("PlaceholderLlmOutreachAdapter throws and writes no draft", async () => {
    const adapter = new PlaceholderLlmOutreachAdapter();
    await expect(
      generateOutreachDraft(
        currentSession,
        {
          type: "recruiter_intro",
          job: job(),
          application: application(),
          recruiterContact: null,
          profile: profile(),
          intelligence: null,
          interviewNotes: []
        },
        adapter
      )
    ).rejects.toThrow(/not configured/i);
    expect(loadOutreachDrafts(currentSession)).toHaveLength(0);
  });
});

describe("recruiterCrmService — reminders", () => {
  it("dueRemindersToday returns only pending reminders within the window", () => {
    const today = new Date("2026-04-25T12:00:00Z");
    const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
    const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
    const past = createFollowUpReminder(currentSession, {
      jobId: "job_crm_test",
      applicationRecordId: "app_crm_test",
      recruiterContactId: null,
      dueAt: yesterday.toISOString(),
      reason: "Past due"
    });
    const todayReminder = createFollowUpReminder(currentSession, {
      jobId: "job_crm_test",
      applicationRecordId: "app_crm_test",
      recruiterContactId: null,
      dueAt: today.toISOString(),
      reason: "Today"
    });
    const completed = createFollowUpReminder(currentSession, {
      jobId: "job_crm_test",
      applicationRecordId: "app_crm_test",
      recruiterContactId: null,
      dueAt: today.toISOString(),
      reason: "Already done"
    });
    updateFollowUpReminder(currentSession, {
      id: completed.reminder.id,
      status: "completed"
    });
    createFollowUpReminder(currentSession, {
      jobId: "job_crm_test",
      applicationRecordId: "app_crm_test",
      recruiterContactId: null,
      dueAt: tomorrow.toISOString(),
      reason: "Future"
    });
    const due = dueRemindersToday(loadFollowUpReminders(currentSession), {
      now: today,
      daysAhead: 0
    });
    const reasons = due.map((reminder) => reminder.reason).sort();
    expect(reasons).toEqual(["Past due", "Today"]);
    expect(due.map((r) => r.id)).toEqual(
      expect.arrayContaining([past.reminder.id, todayReminder.reminder.id])
    );
  });
});

describe("recruiterCrmService — crmForApplication", () => {
  it("returns the CRM bundle scoped to a single application", () => {
    addRecruiterContact(currentSession, {
      jobId: "job_crm_test",
      applicationRecordId: "app_crm_test",
      company: "ExampleCo",
      name: "Jordan"
    });
    addInterviewNote(currentSession, {
      jobId: "job_crm_test",
      applicationRecordId: "app_crm_test",
      stage: "recruiter_screen",
      scheduledAt: null,
      interviewerNames: [],
      notes: "Discussed scope.",
      questionsAsked: [],
      followUps: []
    });
    const bundle = crmForApplication(currentSession, application());
    expect(bundle.contacts).toHaveLength(1);
    expect(bundle.interviewNotes).toHaveLength(1);
    expect(bundle.drafts).toHaveLength(0);
    expect(bundle.reminders).toHaveLength(0);
  });
});
