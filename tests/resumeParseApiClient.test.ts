import { describe, expect, it, vi } from "vitest";
import {
  ApiResumeParseUnavailableError,
  callResumeParseApi
} from "../src/services/resumeParseApiClient";

function jsonResponse(body: unknown, init: { status?: number } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json" }
  });
}

const VALID_BODY = {
  extractedText: "Jane Doe\nSenior Product Manager\njane@example.com",
  parseDiagnostic: {
    status: "good",
    issueType: "ok",
    characterCount: 60,
    extractedFrom: "pdf",
    signalsDetected: {
      hasEmail: true,
      hasPhone: false,
      hasLikelyName: true,
      hasRoleTitle: true,
      hasCompany: false,
      hasDates: false,
      hasSkills: false
    },
    likelyCause: "Resume text extracted successfully.",
    userExplanation: "Resume text quality is good. You can run analysis.",
    recommendedFix: "",
    canRunIntelligence: true,
    canRunLimitedAnalysis: false
  }
};

describe("callResumeParseApi", () => {
  it("returns the parsed body on a 200 response", async () => {
    const fetchImpl = vi.fn(
      async (
        _input: string | URL | Request,
        _init?: RequestInit
      ): Promise<Response> => jsonResponse(VALID_BODY)
    );
    const out = await callResumeParseApi(
      {
        filename: "jane.pdf",
        mimeType: "application/pdf",
        base64Content: Buffer.from([0x25, 0x50, 0x44, 0x46]).toString("base64")
      },
      { fetchImpl: fetchImpl as unknown as typeof fetch }
    );
    expect(out.parseDiagnostic.status).toBe("good");
    expect(out.extractedText).toContain("Jane Doe");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [path, init] = fetchImpl.mock.calls[0];
    expect(path).toBe("/api/resume/parse");
    expect(init?.method).toBe("POST");
  });

  it("throws ApiResumeParseUnavailableError on a 5xx response", async () => {
    const fetchImpl = vi.fn(
      async (): Promise<Response> => jsonResponse({ error: "down" }, { status: 503 })
    );
    await expect(
      callResumeParseApi(
        {
          filename: "x.pdf",
          mimeType: "application/pdf",
          base64Content: "AA=="
        },
        { fetchImpl: fetchImpl as unknown as typeof fetch }
      )
    ).rejects.toBeInstanceOf(ApiResumeParseUnavailableError);
  });

  it("throws on network failure (server offline)", async () => {
    const fetchImpl = vi.fn(async (): Promise<Response> => {
      throw new TypeError("Failed to fetch");
    });
    await expect(
      callResumeParseApi(
        {
          filename: "x.pdf",
          mimeType: "application/pdf",
          base64Content: "AA=="
        },
        { fetchImpl: fetchImpl as unknown as typeof fetch }
      )
    ).rejects.toBeInstanceOf(ApiResumeParseUnavailableError);
  });

  it("throws when the response shape is unexpected", async () => {
    const fetchImpl = vi.fn(
      async (): Promise<Response> => jsonResponse({ hello: "world" })
    );
    await expect(
      callResumeParseApi(
        {
          filename: "x.pdf",
          mimeType: "application/pdf",
          base64Content: "AA=="
        },
        { fetchImpl: fetchImpl as unknown as typeof fetch }
      )
    ).rejects.toBeInstanceOf(ApiResumeParseUnavailableError);
  });
});
