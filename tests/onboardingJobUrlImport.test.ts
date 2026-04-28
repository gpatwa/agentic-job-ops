import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { currentSession } from "../src/data/currentSession";
import {
  loadNormalizedJobs,
  saveNormalizedJobs
} from "../src/services/jobIngestion";
import {
  ONBOARDING_JOB_URL_PLACEHOLDERS,
  applyManualJobOverrides,
  enrichOnboardingImportedJob,
  importOnboardingJobFromUrl,
  jobNeedsManualEnrichment,
  mapGreenhouseSingleJobResponse,
  mapLeverSinglePostingResponse,
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

// ---------------------------------------------------------------------------
// Live enrichment via public ATS APIs
// ---------------------------------------------------------------------------

describe("mapGreenhouseSingleJobResponse — pure mapper", () => {
  const parsed = parseJobUrlForImport(REFERENCE_GREENHOUSE_URL);

  it("returns null when title is missing (treat as empty response)", () => {
    expect(mapGreenhouseSingleJobResponse({ content: "x" }, parsed)).toBeNull();
  });

  it("decodes Greenhouse's HTML-encoded content into plain text", () => {
    // Real Greenhouse returns the body double-escaped: a literal `<p>`
    // arrives in the JSON as `&lt;p&gt;`. The mapper must produce
    // plain text, NOT visible `<p>` tags (the bug behind raw HTML in
    // the EMPLOYER IS LOOKING FOR panel before we flipped stripHtml).
    const patch = mapGreenhouseSingleJobResponse(
      {
        title: "Senior Engineer",
        location: { name: "Remote" },
        content:
          "&lt;p&gt;Build great systems.&lt;/p&gt;&lt;h3&gt;Requirements&lt;/h3&gt;&lt;ul&gt;&lt;li&gt;TypeScript fluency&lt;/li&gt;&lt;li&gt;Distributed systems experience&lt;/li&gt;&lt;/ul&gt;",
        absolute_url: "https://boards.greenhouse.io/afresh/jobs/5843891004"
      },
      parsed
    )!;
    expect(patch.title).toBe("Senior Engineer");
    expect(patch.description).not.toMatch(/<\w+>/);
    expect(patch.description).toContain("Build great systems");
    expect(patch.requirements?.[0]).toBeDefined();
    expect(patch.requirements?.[0]).not.toMatch(/<\w+>/);
  });

  it("title-cases the slug for company when company_name is absent", () => {
    const patch = mapGreenhouseSingleJobResponse(
      {
        title: "PM",
        location: { name: "NYC" },
        content: "&lt;p&gt;Body&lt;/p&gt;"
      },
      parsed
    )!;
    expect(patch.company).toBe("Afresh");
  });

  it("derives remoteType from the location string", () => {
    const remote = mapGreenhouseSingleJobResponse(
      {
        title: "X",
        location: { name: "Remote — Worldwide" },
        content: ""
      },
      parsed
    )!;
    expect(remote.remoteType).toBe("remote");
    const onsite = mapGreenhouseSingleJobResponse(
      {
        title: "X",
        location: { name: "San Francisco" },
        content: ""
      },
      parsed
    )!;
    expect(onsite.remoteType).toBe("onsite");
  });
});

describe("mapLeverSinglePostingResponse — pure mapper", () => {
  const parsed = parseJobUrlForImport(LEVER_URL);

  it("concatenates description + lists + additional into the description text", () => {
    const patch = mapLeverSinglePostingResponse(
      {
        text: "Engineer",
        description: "<p>Top-level summary</p>",
        lists: [
          {
            text: "What you'll do",
            content: "<ul><li>Ship code daily</li><li>Mentor peers</li></ul>"
          }
        ],
        additional: "<p>We're an equal opportunity employer.</p>",
        categories: { location: "Remote" },
        workplaceType: "remote",
        applyUrl: "https://jobs.lever.co/example/abc123-def-456/apply"
      },
      parsed
    )!;
    expect(patch.title).toBe("Engineer");
    expect(patch.description).toContain("Top-level summary");
    expect(patch.description).toContain("Ship code daily");
    expect(patch.description).toContain("equal opportunity");
    expect(patch.responsibilities?.length).toBeGreaterThan(0);
    expect(patch.remoteType).toBe("remote");
    expect(patch.applicationUrl).toBe(
      "https://jobs.lever.co/example/abc123-def-456/apply"
    );
  });
});

describe("enrichOnboardingImportedJob — orchestrator", () => {
  beforeEach(() => installLocalStorageMock());
  afterEach(() => Reflect.deleteProperty(globalThis, "window"));

  it("upgrades a Greenhouse placeholder to real fields when the API returns data", async () => {
    const placeholder = importOnboardingJobFromUrl(
      currentSession,
      REFERENCE_GREENHOUSE_URL
    );
    expect(placeholder.needsManualEnrichment).toBe(true);

    const fetcher = vi.fn(
      async (input: string | URL | Request): Promise<Response> => {
        const url = typeof input === "string" ? input : String(input);
        expect(url).toBe(
          "https://boards-api.greenhouse.io/v1/boards/afresh/jobs/5843891004?content=true"
        );
        return new Response(
          JSON.stringify({
            title: "Senior Engineer",
            location: { name: "Remote" },
            content:
              "&lt;p&gt;Build great systems.&lt;/p&gt;&lt;h3&gt;Requirements&lt;/h3&gt;&lt;ul&gt;&lt;li&gt;TypeScript fluency&lt;/li&gt;&lt;/ul&gt;",
            absolute_url:
              "https://boards.greenhouse.io/afresh/jobs/5843891004",
            first_published: "2026-04-01T00:00:00Z"
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
    );

    const result = await enrichOnboardingImportedJob(
      currentSession,
      placeholder.job.id,
      fetcher as unknown as typeof fetch
    );
    expect(result.enriched).toBe(true);
    expect(result.failureReason).toBeNull();
    expect(result.job.title).toBe("Senior Engineer");
    expect(result.job.description).toContain("Build great systems");
    expect(result.job.description).not.toMatch(/<\w+>/);
    expect(jobNeedsManualEnrichment(result.job)).toBe(false);
    // Persisted to storage.
    const stored = loadNormalizedJobs(currentSession).find(
      (j) => j.id === placeholder.job.id
    )!;
    expect(stored.title).toBe("Senior Engineer");
  });

  it("classifies HTTP 404 as http_4xx and leaves the placeholder untouched", async () => {
    const placeholder = importOnboardingJobFromUrl(
      currentSession,
      REFERENCE_GREENHOUSE_URL
    );
    const fetcher = vi.fn(
      async (): Promise<Response> =>
        new Response("not found", { status: 404 })
    );
    const result = await enrichOnboardingImportedJob(
      currentSession,
      placeholder.job.id,
      fetcher as unknown as typeof fetch
    );
    expect(result.enriched).toBe(false);
    expect(result.failureReason).toBe("http_4xx");
    expect(result.job.title).toBe(ONBOARDING_JOB_URL_PLACEHOLDERS.title);
  });

  it("classifies a thrown fetch as network failure", async () => {
    const placeholder = importOnboardingJobFromUrl(
      currentSession,
      REFERENCE_GREENHOUSE_URL
    );
    const fetcher = vi.fn(async () => {
      throw new Error("network down");
    });
    const result = await enrichOnboardingImportedJob(
      currentSession,
      placeholder.job.id,
      fetcher as unknown as typeof fetch
    );
    expect(result.enriched).toBe(false);
    expect(result.failureReason).toBe("network");
    expect(result.job.title).toBe(ONBOARDING_JOB_URL_PLACEHOLDERS.title);
  });

  it("returns unsupported_source for a generic non-Greenhouse/Lever URL", async () => {
    const placeholder = importOnboardingJobFromUrl(currentSession, GENERIC_URL);
    const fetcher = vi.fn();
    const result = await enrichOnboardingImportedJob(
      currentSession,
      placeholder.job.id,
      fetcher as unknown as typeof fetch
    );
    expect(result.enriched).toBe(false);
    expect(result.failureReason).toBe("url_missing_slug_or_id");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("is a no-op when the job already has real data", async () => {
    importOnboardingJobFromUrl(currentSession, REFERENCE_GREENHOUSE_URL, {
      title: "Already-set title",
      company: "Already-set company",
      location: "Already-set location"
    });
    const placeholder = loadNormalizedJobs(currentSession)[0]!;
    // Description still placeholder, but title/company/location set.
    // jobNeedsManualEnrichment ORs all four placeholder checks — so
    // the description-only case still triggers enrichment. Patch
    // the description via saveNormalizedJobs (which uses the real
    // ajo: prefixed scoped key) to truly clear the flag.
    saveNormalizedJobs(currentSession, [
      { ...placeholder, description: "Real description text." }
    ]);
    const fetcher = vi.fn();
    const result = await enrichOnboardingImportedJob(
      currentSession,
      placeholder.id,
      fetcher as unknown as typeof fetch
    );
    expect(result.enriched).toBe(false);
    expect(result.failureReason).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("hits the Lever single-posting endpoint for Lever URLs", async () => {
    const placeholder = importOnboardingJobFromUrl(currentSession, LEVER_URL);
    let calledUrl = "";
    const fetcher = vi.fn(
      async (input: string | URL | Request): Promise<Response> => {
        calledUrl = typeof input === "string" ? input : String(input);
        return new Response(
          JSON.stringify({
            text: "Senior Backend",
            description: "<p>Build APIs</p>",
            lists: [],
            categories: { location: "Remote" },
            workplaceType: "remote"
          }),
          { status: 200 }
        );
      }
    );
    const result = await enrichOnboardingImportedJob(
      currentSession,
      placeholder.job.id,
      fetcher as unknown as typeof fetch
    );
    expect(calledUrl).toBe(
      "https://api.lever.co/v0/postings/example/abc123-def-456?mode=json"
    );
    expect(result.enriched).toBe(true);
    expect(result.job.title).toBe("Senior Backend");
  });
});
