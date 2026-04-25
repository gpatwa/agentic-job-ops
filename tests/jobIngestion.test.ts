import { describe, expect, it } from "vitest";
import { currentSession } from "../src/data/currentSession";
import type { JobSourceConfig, NormalizedJob } from "../src/models/domain";
import {
  createGreenhouseConnector,
  createLeverConnector,
  createManualJobImportPlaceholder,
  deduplicateAndMergeJobs,
  isConfigDueForScheduledScan,
  type Fetcher
} from "../src/services/jobIngestion";

function sourceConfig(overrides: Partial<JobSourceConfig> = {}): JobSourceConfig {
  const now = new Date().toISOString();

  return {
    id: "source_1",
    tenantId: currentSession.tenant.id,
    userId: currentSession.userId,
    source: "greenhouse",
    displayName: "Example careers",
    companyName: "Example Co",
    boardToken: "example",
    siteName: "",
    manualUrl: "",
    schedule: "manual",
    enabled: true,
    lastScanAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

function responseJson(payload: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => payload
  } as Response;
}

describe("job ingestion connectors", () => {
  it("normalizes Greenhouse jobs into queued normalized jobs", async () => {
    let requestedUrl = "";
    const fetcher: Fetcher = (async (url: RequestInfo | URL) => {
      requestedUrl = String(url);
      return responseJson({
        jobs: [
          {
            id: 123,
            title: "Staff Engineer",
            updated_at: "2026-04-01T12:00:00Z",
            location: { name: "Remote" },
            absolute_url: "https://boards.greenhouse.io/example/jobs/123",
            content: "<p>Build systems</p><p>Requirements: TypeScript</p>"
          }
        ]
      });
    }) as Fetcher;

    const result = await createGreenhouseConnector().ingest({
      session: currentSession,
      config: sourceConfig(),
      fetcher
    });

    expect(requestedUrl).toContain(
      "https://boards-api.greenhouse.io/v1/boards/example/jobs?content=true"
    );
    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0]).toMatchObject({
      tenantId: currentSession.tenant.id,
      userId: currentSession.userId,
      source: "greenhouse",
      sourceJobId: "123",
      company: "Example Co",
      remoteType: "remote",
      scoringStatus: "queued"
    });
  });

  it("normalizes Lever jobs into queued normalized jobs", async () => {
    const fetcher: Fetcher = (async () =>
      responseJson([
        {
          id: "abc",
          text: "Product Manager",
          categories: { location: "New York, NY" },
          workplaceType: "hybrid",
          descriptionPlain: "Own product outcomes",
          lists: [{ text: "Requirements", content: "<li>Customer empathy</li>" }],
          hostedUrl: "https://jobs.lever.co/example/abc",
          applyUrl: "https://jobs.lever.co/example/abc/apply",
          createdAt: 1775150400000,
          salaryRange: { min: 120000, max: 160000 }
        }
      ])) as Fetcher;

    const result = await createLeverConnector().ingest({
      session: currentSession,
      config: sourceConfig({
        source: "lever",
        boardToken: "",
        siteName: "example"
      }),
      fetcher
    });

    expect(result.jobs[0]).toMatchObject({
      source: "lever",
      sourceJobId: "abc",
      title: "Product Manager",
      remoteType: "hybrid",
      salaryMin: 120000,
      salaryMax: 160000,
      scoringStatus: "queued"
    });
  });
});

describe("job deduplication", () => {
  it("does not insert repeated ATS jobs", () => {
    const first = createManualJobImportPlaceholder(
      currentSession,
      "https://example.com/jobs/1"
    );
    const repeated: NormalizedJob = {
      ...first,
      id: "job_second",
      updatedAt: new Date().toISOString()
    };

    const summary = deduplicateAndMergeJobs([first], [repeated]);

    expect(summary.jobs).toHaveLength(1);
    expect(summary.inserted).toBe(0);
    expect(summary.updated).toBe(1);
    expect(summary.duplicatesSkipped).toBe(1);
    expect(summary.duplicateReasons.ats_job_id).toBe(1);
  });

  it("marks scheduled configs due based on cadence", () => {
    const at = new Date("2026-04-25T12:00:00Z");

    expect(
      isConfigDueForScheduledScan(
        sourceConfig({
          schedule: "every_6_hours",
          lastScanAt: "2026-04-25T05:59:59.000Z"
        }),
        at
      )
    ).toBe(true);
    expect(
      isConfigDueForScheduledScan(
        sourceConfig({
          schedule: "daily",
          lastScanAt: "2026-04-25T05:59:59.000Z"
        }),
        at
      )
    ).toBe(false);
  });
});
