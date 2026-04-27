import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { currentSession } from "../src/data/currentSession";
import { loadNormalizedJobs } from "../src/services/jobIngestion";
import {
  ONBOARDING_JOB_URL_PLACEHOLDERS,
  applyManualJobOverrides,
  importOnboardingJobFromUrl,
  jobNeedsManualEnrichment,
  parseJobUrlForImport
} from "../src/services/onboardingJobUrlImport";

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

const REFERENCE_GREENHOUSE_URL =
  "https://job-boards.greenhouse.io/afresh/jobs/5843891004";
const LEGACY_GREENHOUSE_URL =
  "https://boards.greenhouse.io/airbnb/jobs/4567890";
const LEVER_URL = "https://jobs.lever.co/example/abc123-def-456";
const GENERIC_URL = "https://careers.example.com/postings/senior-pm";

describe("parseJobUrlForImport", () => {
  it("detects modern Greenhouse URLs and extracts company + jobId", () => {
    const parsed = parseJobUrlForImport(REFERENCE_GREENHOUSE_URL);
    expect(parsed.source).toBe("greenhouse");
    expect(parsed.atsType).toBe("greenhouse");
    expect(parsed.companySlug).toBe("afresh");
    expect(parsed.externalJobId).toBe("5843891004");
    expect(parsed.detectedHostname).toBe("job-boards.greenhouse.io");
    expect(parsed.originalUrl).toBe(REFERENCE_GREENHOUSE_URL);
  });

  it("detects legacy boards.greenhouse.io URLs", () => {
    const parsed = parseJobUrlForImport(LEGACY_GREENHOUSE_URL);
    expect(parsed.source).toBe("greenhouse");
    expect(parsed.companySlug).toBe("airbnb");
    expect(parsed.externalJobId).toBe("4567890");
  });

  it("detects Lever URLs and extracts company + jobId", () => {
    const parsed = parseJobUrlForImport(LEVER_URL);
    expect(parsed.source).toBe("lever");
    expect(parsed.atsType).toBe("lever");
    expect(parsed.companySlug).toBe("example");
    expect(parsed.externalJobId).toBe("abc123-def-456");
  });

  it("falls back to source=manual for generic URLs", () => {
    const parsed = parseJobUrlForImport(GENERIC_URL);
    expect(parsed.source).toBe("manual");
    expect(parsed.atsType).toBe("manual");
    expect(parsed.companySlug).toBeNull();
    expect(parsed.externalJobId).toBeNull();
    expect(parsed.detectedHostname).toBe("careers.example.com");
  });

  it("returns source=manual with empty hostname for malformed input", () => {
    const parsed = parseJobUrlForImport("not a url");
    expect(parsed.source).toBe("manual");
    expect(parsed.detectedHostname).toBe("");
    expect(parsed.companySlug).toBeNull();
  });

  it("trims whitespace around the URL before parsing", () => {
    const parsed = parseJobUrlForImport(`   ${REFERENCE_GREENHOUSE_URL}   `);
    expect(parsed.source).toBe("greenhouse");
    expect(parsed.originalUrl).toBe(REFERENCE_GREENHOUSE_URL);
  });
});

describe("importOnboardingJobFromUrl", () => {
  beforeEach(() => installLocalStorageMock());
  afterEach(() => Reflect.deleteProperty(globalThis, "window"));

  it("creates a NormalizedJob from a Greenhouse URL with placeholder fields and queued scoring", () => {
    const result = importOnboardingJobFromUrl(
      currentSession,
      REFERENCE_GREENHOUSE_URL
    );
    expect(result.isDuplicate).toBe(false);
    expect(result.needsManualEnrichment).toBe(true);
    expect(result.job.source).toBe("greenhouse");
    expect(result.job.atsType).toBe("greenhouse");
    expect(result.job.applicationUrl).toBe(REFERENCE_GREENHOUSE_URL);
    expect(result.job.title).toBe(ONBOARDING_JOB_URL_PLACEHOLDERS.title);
    // Company falls back to the slug (title-cased) instead of the
    // generic placeholder so the user has a recognisable hint.
    expect(result.job.company).toBe("Afresh");
    expect(result.job.location).toBe(ONBOARDING_JOB_URL_PLACEHOLDERS.location);
    expect(result.job.scoringStatus).toBe("queued");
    expect(result.job.tenantId).toBe(currentSession.tenant.id);
    expect(result.job.userId).toBe(currentSession.userId);
  });

  it("falls back cleanly for a generic URL (no slug → generic Unknown company placeholder)", () => {
    const result = importOnboardingJobFromUrl(currentSession, GENERIC_URL);
    expect(result.job.source).toBe("manual");
    expect(result.job.atsType).toBe("manual");
    expect(result.job.company).toBe(ONBOARDING_JOB_URL_PLACEHOLDERS.company);
    expect(result.needsManualEnrichment).toBe(true);
  });

  it("is idempotent: re-importing the same Greenhouse URL returns the existing record", () => {
    const first = importOnboardingJobFromUrl(
      currentSession,
      REFERENCE_GREENHOUSE_URL
    );
    const second = importOnboardingJobFromUrl(
      currentSession,
      REFERENCE_GREENHOUSE_URL
    );
    expect(second.isDuplicate).toBe(true);
    expect(second.job.id).toBe(first.job.id);
    // And the storage doesn't grow.
    expect(loadNormalizedJobs(currentSession)).toHaveLength(1);
  });

  it("is idempotent across query-string variations on Greenhouse URLs", () => {
    const first = importOnboardingJobFromUrl(
      currentSession,
      REFERENCE_GREENHOUSE_URL
    );
    const second = importOnboardingJobFromUrl(
      currentSession,
      `${REFERENCE_GREENHOUSE_URL}?gh_src=newsletter&utm=foo`
    );
    expect(second.job.id).toBe(first.job.id);
    expect(loadNormalizedJobs(currentSession)).toHaveLength(1);
  });

  it("applies manual overrides at import time when title/company/location are placeholders", () => {
    const result = importOnboardingJobFromUrl(
      currentSession,
      GENERIC_URL,
      {
        title: "Senior Product Manager, Workflow",
        company: "ExampleCo",
        location: "Remote"
      }
    );
    expect(result.job.title).toBe("Senior Product Manager, Workflow");
    expect(result.job.company).toBe("ExampleCo");
    expect(result.job.location).toBe("Remote");
    // The needs-manual-enrichment flag should now be FALSE for these
    // three fields. The description is still placeholder so the flag
    // stays true (low-confidence scoring caveat).
    expect(result.needsManualEnrichment).toBe(true);
  });

  it("applyManualJobOverrides fills placeholder fields without overwriting real values", () => {
    const created = importOnboardingJobFromUrl(
      currentSession,
      GENERIC_URL,
      { title: "Real Title", company: "Real Co" } // location stays placeholder
    );
    expect(created.job.location).toBe(
      ONBOARDING_JOB_URL_PLACEHOLDERS.location
    );

    // Update only location.
    const updatedFirst = applyManualJobOverrides(currentSession, created.job.id, {
      location: "San Francisco"
    });
    expect(updatedFirst.location).toBe("San Francisco");
    expect(updatedFirst.title).toBe("Real Title");
    expect(updatedFirst.company).toBe("Real Co");

    // Now try to re-override title — it's NOT a placeholder anymore,
    // so the override is rejected to protect user-saved data.
    const updatedSecond = applyManualJobOverrides(currentSession, created.job.id, {
      title: "DO NOT OVERWRITE"
    });
    expect(updatedSecond.title).toBe("Real Title");
  });

  it("throws on empty URL input", () => {
    expect(() => importOnboardingJobFromUrl(currentSession, "   ")).toThrow();
  });

  it("jobNeedsManualEnrichment is false once title/company/location AND description are populated", () => {
    const result = importOnboardingJobFromUrl(
      currentSession,
      GENERIC_URL,
      { title: "PM", company: "ExampleCo", location: "Remote" }
    );
    // Description is still the placeholder → flag stays true (caveat).
    expect(jobNeedsManualEnrichment(result.job)).toBe(true);
    // Simulate a downstream enricher rewriting the description.
    const enriched = { ...result.job, description: "Full job description here." };
    expect(jobNeedsManualEnrichment(enriched)).toBe(false);
  });
});
