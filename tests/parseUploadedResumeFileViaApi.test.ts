import { describe, expect, it, vi } from "vitest";
import { currentSession } from "../src/data/currentSession";
import { parseUploadedResumeFileViaApi } from "../src/services/resumeService";

const SAMPLE_TEXT = `Jane Doe
Senior Product Manager
jane@example.com
+1 555-555-0100

Experience
Senior Product Manager — DemoLabs — 2022 - 2026
Led B2B SaaS workflow automation roadmap; +20% activation.

Skills
Product Management, Roadmap`;

const SUCCESS_DIAGNOSTIC = {
  status: "good" as const,
  issueType: "ok" as const,
  characterCount: SAMPLE_TEXT.length,
  extractedFrom: "pdf" as const,
  signalsDetected: {
    hasEmail: true,
    hasPhone: true,
    hasLikelyName: true,
    hasRoleTitle: true,
    hasCompany: true,
    hasDates: true,
    hasSkills: true
  },
  likelyCause: "Resume text extracted successfully.",
  userExplanation: "Resume text quality is good.",
  recommendedFix: "",
  canRunIntelligence: true,
  canRunLimitedAnalysis: false
};

const SCANNED_DIAGNOSTIC = {
  status: "unreadable" as const,
  issueType: "scanned_or_image_pdf" as const,
  characterCount: 0,
  extractedFrom: "pdf" as const,
  signalsDetected: {
    hasEmail: false,
    hasPhone: false,
    hasLikelyName: false,
    hasRoleTitle: false,
    hasCompany: false,
    hasDates: false,
    hasSkills: false
  },
  likelyCause: "PDF appears to be scanned.",
  userExplanation: "We couldn't read text from this PDF.",
  recommendedFix: "Paste your resume text below.",
  canRunIntelligence: false,
  canRunLimitedAnalysis: false
};

describe("parseUploadedResumeFileViaApi", () => {
  it("uses the API extracted text when the server returns canRunIntelligence=true", async () => {
    const fakePdf = new File([new Uint8Array([0x25, 0x50, 0x44])], "jane.pdf", {
      type: "application/pdf"
    });
    const callResumeParseApi = vi.fn(async () => ({
      extractedText: SAMPLE_TEXT,
      parseDiagnostic: SUCCESS_DIAGNOSTIC
    }));
    const fileToBase64 = vi.fn(async () => "JVBE");
    const result = await parseUploadedResumeFileViaApi(currentSession, fakePdf, {
      callResumeParseApi,
      fileToBase64
    });
    expect(callResumeParseApi).toHaveBeenCalledTimes(1);
    expect(result.resume.parsedText).toBe(SAMPLE_TEXT);
    expect(result.resume.status).toBe("parsed");
    expect(result.extractionPending).toBe(false);
    expect(result.parseDiagnostic?.status).toBe("good");
  });

  it("falls back to the placeholder path when the API marks the parse unreadable", async () => {
    const fakePdf = new File([new Uint8Array([0x25, 0x50, 0x44])], "jane.pdf", {
      type: "application/pdf"
    });
    const callResumeParseApi = vi.fn(async () => ({
      extractedText: "",
      parseDiagnostic: SCANNED_DIAGNOSTIC
    }));
    const fileToBase64 = vi.fn(async () => "JVBE");
    const result = await parseUploadedResumeFileViaApi(currentSession, fakePdf, {
      callResumeParseApi,
      fileToBase64
    });
    // Resume record uses the placeholder path so the UI's parsing-
    // issue card kicks in. The diagnostic from the server is
    // surfaced for the card to render.
    expect(result.resume.status).toBe("uploaded");
    expect(result.resume.parsedText).toContain(
      "Resume text extraction has not run yet"
    );
    expect(result.extractionPending).toBe(true);
    expect(result.parseDiagnostic?.issueType).toBe("scanned_or_image_pdf");
  });

  it("falls back to the placeholder path AND null diagnostic when the API throws (offline)", async () => {
    const fakePdf = new File([new Uint8Array([0x25, 0x50, 0x44])], "jane.pdf", {
      type: "application/pdf"
    });
    const callResumeParseApi = vi.fn(async () => {
      const { ApiResumeParseUnavailableError } = await import(
        "../src/services/resumeParseApiClient"
      );
      throw new ApiResumeParseUnavailableError("offline");
    });
    const fileToBase64 = vi.fn(async () => "JVBE");
    const result = await parseUploadedResumeFileViaApi(currentSession, fakePdf, {
      callResumeParseApi,
      fileToBase64
    });
    expect(result.resume.status).toBe("uploaded");
    expect(result.parseDiagnostic).toBeNull();
  });

  it("does not call the API for TXT/MD uploads (handled locally)", async () => {
    const fakeTxt = new File([SAMPLE_TEXT], "jane.txt", { type: "text/plain" });
    const callResumeParseApi = vi.fn();
    const result = await parseUploadedResumeFileViaApi(currentSession, fakeTxt, {
      callResumeParseApi: callResumeParseApi as never,
      fileToBase64: vi.fn(async () => "")
    });
    expect(callResumeParseApi).not.toHaveBeenCalled();
    expect(result.resume.parsedText).toContain("Jane Doe");
    expect(result.resume.status).toBe("parsed");
    expect(result.parseDiagnostic).toBeNull();
  });
});
