import { describe, expect, it, vi } from "vitest";
import {
  ApiResumeIntelligenceUnavailableError,
  callResumeIntelligenceApi,
  fetchAiStatus
} from "../src/services/resumeIntelligenceApiClient";

function jsonResponse(body: unknown, init: { status?: number } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json" }
  });
}

const VALID_BODY = {
  extractionMode: "llm",
  provider: "openai",
  modelName: "gpt-4.1-mini",
  promptVersion: "resume-intelligence-openai-v1",
  fallbackUsed: false,
  report: {
    extractionMode: "llm",
    provider: "openai",
    modelName: "gpt-4.1-mini",
    promptVersion: "resume-intelligence-openai-v1",
    extractedProfile: {},
    confidenceByField: {},
    missingFields: [],
    ambiguousFields: [],
    parsingWarnings: [],
    atsRiskScore: 10,
    atsRiskLevel: "low",
    suggestedFixes: [],
    recommendation: { strongestRoles: [] }
  }
};

describe("callResumeIntelligenceApi", () => {
  it("returns the parsed body on a 200 response", async () => {
    // Typed signature so mock.calls[0] destructures as
    // [string | URL | Request, RequestInit | undefined].
    const fetchImpl = vi.fn(
      async (
        _input: string | URL | Request,
        _init?: RequestInit
      ): Promise<Response> => jsonResponse(VALID_BODY)
    );
    const out = await callResumeIntelligenceApi(
      { resumeId: "r1", resumeText: "Hello world resume content" },
      { fetchImpl: fetchImpl as unknown as typeof fetch }
    );
    expect(out.provider).toBe("openai");
    expect(out.extractionMode).toBe("llm");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [path, init] = fetchImpl.mock.calls[0];
    expect(path).toBe("/api/resume-intelligence");
    expect(init?.method).toBe("POST");
  });

  it("throws ApiResumeIntelligenceUnavailableError on a 5xx response", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: "down" }, { status: 503 })
    );
    await expect(
      callResumeIntelligenceApi(
        { resumeId: "r1", resumeText: "Hello world resume content" },
        { fetchImpl: fetchImpl as unknown as typeof fetch }
      )
    ).rejects.toBeInstanceOf(ApiResumeIntelligenceUnavailableError);
  });

  it("throws when the network call rejects (server offline)", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(
      callResumeIntelligenceApi(
        { resumeId: "r1", resumeText: "Hello world resume content" },
        { fetchImpl: fetchImpl as unknown as typeof fetch }
      )
    ).rejects.toBeInstanceOf(ApiResumeIntelligenceUnavailableError);
  });

  it("throws when the response body has the wrong shape", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ surprise: true }));
    await expect(
      callResumeIntelligenceApi(
        { resumeId: "r1", resumeText: "Hello world resume content" },
        { fetchImpl: fetchImpl as unknown as typeof fetch }
      )
    ).rejects.toBeInstanceOf(ApiResumeIntelligenceUnavailableError);
  });
});

describe("fetchAiStatus", () => {
  it("returns the status snapshot when the API is reachable", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        provider: "azure_openai",
        configured: true,
        fallbackAvailable: true,
        resumeModel: "deploy-x",
        jobModel: "deploy-y"
      })
    );
    const out = await fetchAiStatus({
      fetchImpl: fetchImpl as unknown as typeof fetch
    });
    expect(out?.provider).toBe("azure_openai");
  });

  it("returns null when the API is unreachable", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    const out = await fetchAiStatus({
      fetchImpl: fetchImpl as unknown as typeof fetch
    });
    expect(out).toBeNull();
  });
});
