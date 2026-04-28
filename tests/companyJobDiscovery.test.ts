import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { currentSession } from "../src/data/currentSession";
import {
  CURATED_COMPANY_CATALOG,
  pickCuratedCompaniesForResume
} from "../src/data/curatedCompanyCatalog";
import {
  discoverAndIngestForRecommendation,
  discoverCompaniesForRecommendation,
  ensureCuratedCompanyConfigsSeeded
} from "../src/services/companyJobDiscovery";
import {
  loadJobSourceConfigs,
  loadNormalizedJobs,
  saveJobSourceConfigs,
  saveNormalizedJobs
} from "../src/services/jobIngestion";
import type { JobTargetRecommendation } from "../src/models/domain";

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

function makeRecommendation(
  overrides: Partial<JobTargetRecommendation> = {}
): JobTargetRecommendation {
  const now = new Date().toISOString();
  return {
    id: "rec_test",
    tenantId: currentSession.tenant.id,
    userId: currentSession.userId,
    resumeId: "resume_test",
    reportId: "report_test",
    strongestRoles: [],
    adjacentRoles: [],
    stretchRoles: [],
    rolesToAvoid: [],
    recommendedIndustries: [],
    recommendedSeniority: "",
    recommendedSearchKeywords: [],
    positioningSummary: "",
    resumePositioningAdvice: [],
    skillGaps: [],
    confidence: "medium",
    extractionMode: "llm",
    modelName: "test",
    promptVersion: "test",
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

describe("pickCuratedCompaniesForResume — pure matching", () => {
  it("returns empty when no industries/roles are provided", () => {
    expect(
      pickCuratedCompaniesForResume({
        industries: [],
        roleTitles: [],
        searchKeywords: []
      })
    ).toEqual([]);
  });

  it("matches Anthropic for an AI-leaning resume", () => {
    const matches = pickCuratedCompaniesForResume({
      industries: ["AI", "Developer infrastructure"],
      roleTitles: ["AI Engineer", "Engineering Manager"],
      searchKeywords: []
    });
    expect(matches.some((c) => c.slug === "anthropic")).toBe(true);
  });

  it("matches Stripe + Coinbase for a fintech resume", () => {
    const matches = pickCuratedCompaniesForResume({
      industries: ["Fintech", "Payments"],
      roleTitles: ["Engineering Manager"],
      searchKeywords: []
    });
    const slugs = matches.map((c) => c.slug);
    expect(slugs).toContain("stripe");
    expect(slugs).toContain("coinbase");
  });

  it("uses bidirectional substring match (catalog tag substring of LLM industry, or vice versa)", () => {
    const matches = pickCuratedCompaniesForResume({
      industries: ["Developer Infrastructure / Tools"],
      roleTitles: [],
      searchKeywords: []
    });
    // Anthropic + Figma + GitLab + Stripe all tag "Developer
    // infrastructure" — bidirectional substring picks them up.
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it("never returns a company more than once", () => {
    const matches = pickCuratedCompaniesForResume({
      industries: ["B2B SaaS", "Developer infrastructure"],
      roleTitles: ["Engineering Manager", "Product Manager"],
      searchKeywords: ["engineering"]
    });
    const slugs = matches.map((c) => c.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });
});

describe("discoverCompaniesForRecommendation — recommendation → catalog", () => {
  it("returns empty when recommendation is null", () => {
    expect(discoverCompaniesForRecommendation(null)).toEqual([]);
  });

  it("flattens roles from strongest/adjacent/stretch into the search input", () => {
    const matches = discoverCompaniesForRecommendation(
      makeRecommendation({
        recommendedIndustries: ["Fintech"],
        recommendedSearchKeywords: [],
        strongestRoles: [
          {
            title: "Senior Engineering Manager",
            fitLevel: "strong",
            confidence: "high",
            why: "",
            evidenceFromResume: [],
            searchKeywords: [],
            suggestedResumeAngle: ""
          }
        ]
      })
    );
    expect(matches.length).toBeGreaterThan(0);
    expect(matches.some((c) => c.slug === "stripe")).toBe(true);
  });
});

describe("ensureCuratedCompanyConfigsSeeded — idempotent seeder", () => {
  beforeEach(() => installLocalStorageMock());
  afterEach(() => Reflect.deleteProperty(globalThis, "window"));

  it("creates JobSourceConfig records for new companies", () => {
    const seeded = ensureCuratedCompanyConfigsSeeded(currentSession, [
      CURATED_COMPANY_CATALOG[0],
      CURATED_COMPANY_CATALOG[1]
    ]);
    expect(seeded).toHaveLength(2);
    const stored = loadJobSourceConfigs(currentSession);
    expect(stored).toHaveLength(2);
    expect(stored.map((c) => c.boardToken).sort()).toEqual(
      [CURATED_COMPANY_CATALOG[0].slug, CURATED_COMPANY_CATALOG[1].slug].sort()
    );
  });

  it("is idempotent: re-running does not create duplicate configs", () => {
    ensureCuratedCompanyConfigsSeeded(currentSession, [
      CURATED_COMPANY_CATALOG[0]
    ]);
    ensureCuratedCompanyConfigsSeeded(currentSession, [
      CURATED_COMPANY_CATALOG[0]
    ]);
    expect(loadJobSourceConfigs(currentSession)).toHaveLength(1);
  });

  it("preserves user-added configs when seeding new ones", () => {
    saveJobSourceConfigs(currentSession, [
      {
        id: "user_added",
        tenantId: currentSession.tenant.id,
        userId: currentSession.userId,
        source: "greenhouse",
        displayName: "Custom",
        companyName: "Custom",
        boardToken: "custom",
        siteName: "",
        manualUrl: "",
        schedule: "manual",
        enabled: true,
        lastScanAt: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    ]);
    ensureCuratedCompanyConfigsSeeded(currentSession, [
      CURATED_COMPANY_CATALOG[0]
    ]);
    const all = loadJobSourceConfigs(currentSession);
    expect(all.some((c) => c.boardToken === "custom")).toBe(true);
    expect(
      all.some((c) => c.boardToken === CURATED_COMPANY_CATALOG[0].slug)
    ).toBe(true);
  });
});

describe("discoverAndIngestForRecommendation — orchestrator", () => {
  beforeEach(() => installLocalStorageMock());
  afterEach(() => Reflect.deleteProperty(globalThis, "window"));

  it("returns empty result when no companies match the recommendation", async () => {
    const result = await discoverAndIngestForRecommendation(
      currentSession,
      makeRecommendation({
        recommendedIndustries: ["No Such Industry XYZ"],
        recommendedSearchKeywords: []
      }),
      { ttlMs: 0 }
    );
    expect(result.matched).toEqual([]);
    expect(result.succeeded).toEqual([]);
    expect(result.failed).toEqual([]);
    expect(result.totalJobs).toBe(0);
  });

  it("respects the cache TTL on repeat calls", async () => {
    // Seed an existing real job so the function reports realistic
    // totalJobs and so the cache test doesn't need to hit network.
    saveNormalizedJobs(currentSession, [
      {
        id: "job_existing",
        tenantId: currentSession.tenant.id,
        userId: currentSession.userId,
        sourceConfigId: null,
        source: "manual",
        sourceJobId: "exist",
        title: "Existing Job",
        company: "Co",
        location: "Remote",
        remoteType: "remote",
        salaryMin: null,
        salaryMax: null,
        description: "",
        responsibilities: [],
        requirements: [],
        applicationUrl: "https://example.com",
        atsType: "manual",
        postedAt: null,
        discoveredAt: new Date().toISOString(),
        scoringStatus: "queued",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    ]);
    // Force cache by setting a very long TTL and a fetcher that
    // would error if called — proving the cache short-circuits.
    const noCallFetcher = vi.fn(() => {
      throw new Error("fetcher should not be called when cache is fresh");
    });

    const recommendation = makeRecommendation({
      recommendedIndustries: ["AI"]
    });

    // First call seeds configs and (would) ingest. We supply a
    // fetcher that returns an empty job list so no real network
    // call happens but ingestion technically "succeeded".
    const okFetcher = vi.fn(
      async (): Promise<Response> =>
        new Response(JSON.stringify({ jobs: [] }), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
    );
    const first = await discoverAndIngestForRecommendation(
      currentSession,
      recommendation,
      { fetcher: okFetcher as unknown as typeof fetch, ttlMs: 60_000 }
    );
    expect(first.cached).toBe(false);
    expect(first.matched.length).toBeGreaterThan(0);
    expect(okFetcher).toHaveBeenCalled();

    // Second call within TTL — must be cached, no fetcher calls.
    const second = await discoverAndIngestForRecommendation(
      currentSession,
      recommendation,
      { fetcher: noCallFetcher as unknown as typeof fetch, ttlMs: 60_000 }
    );
    expect(second.cached).toBe(true);
    expect(noCallFetcher).not.toHaveBeenCalled();
  });

  it("isolates per-source failures (one slow board does not block others)", async () => {
    const successCount = { value: 0 };
    const failCount = { value: 0 };
    const fetcher = vi.fn(
      async (input: string | URL | Request): Promise<Response> => {
        const url = typeof input === "string" ? input : String(input);
        // Fail every other call to exercise the
        // Promise.allSettled isolation guarantee.
        if (url.includes("airbnb")) {
          failCount.value += 1;
          throw new Error("simulated network failure");
        }
        successCount.value += 1;
        return new Response(JSON.stringify({ jobs: [] }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
    );
    const result = await discoverAndIngestForRecommendation(
      currentSession,
      makeRecommendation({
        recommendedIndustries: ["Marketplace", "Fintech"]
      }),
      {
        fetcher: fetcher as unknown as typeof fetch,
        ttlMs: 0
      }
    );
    expect(result.matched.length).toBeGreaterThan(0);
    expect(result.failed.length).toBeGreaterThan(0);
    expect(result.succeeded.length).toBeGreaterThan(0);
    // The orchestrator returned even though one board failed.
    expect(failCount.value).toBeGreaterThan(0);
    expect(successCount.value).toBeGreaterThan(0);
  });
});
