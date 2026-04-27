import { describe, expect, it, vi } from "vitest";
import { handleResumeParse } from "../../../server/routes/resumeParseRoute";

const SAMPLE_RESUME = `Jane Doe
Senior Product Manager
Remote
jane.doe@example.com
+1 555-555-0100

Experience
Senior Product Manager — DemoLabs — 2022 - 2026
Led B2B SaaS workflow automation roadmap; +20% activation.

Skills
Product Management, Roadmap, Customer Discovery, SQL`;

const SECRET_RESUME_LITERAL = "TOP_SECRET_RESUME_BLOB_NEVER_LOG_ME";

function base64(text: string): string {
  return Buffer.from(text, "utf-8").toString("base64");
}

describe("POST /api/resume/parse — request validation", () => {
  it("rejects an empty body with 400", async () => {
    const result = await handleResumeParse({});
    expect(result.status).toBe(400);
  });

  it("rejects malformed Base64 with 400", async () => {
    const result = await handleResumeParse({
      filename: "x.txt",
      mimeType: "text/plain",
      base64Content: "this is not base64!!!"
    });
    expect(result.status).toBe(400);
    expect(result.logs.some((l) => l.message.includes("base64_decode_failed"))).toBe(true);
  });

  it("requires filename and mimeType", async () => {
    const result = await handleResumeParse({
      base64Content: base64(SAMPLE_RESUME)
    });
    expect(result.status).toBe(400);
  });
});

describe("POST /api/resume/parse — success paths", () => {
  it("returns 200 with extractedText + parseDiagnostic for a TXT payload", async () => {
    const result = await handleResumeParse({
      filename: "jane.txt",
      mimeType: "text/plain",
      base64Content: base64(SAMPLE_RESUME)
    });
    expect(result.status).toBe(200);
    const body = result.body as {
      extractedText: string;
      parseDiagnostic: { status: string; canRunIntelligence: boolean };
    };
    expect(body.extractedText).toContain("Jane Doe");
    expect(body.parseDiagnostic.status).toBe("good");
    expect(body.parseDiagnostic.canRunIntelligence).toBe(true);
  });

  it("returns 200 + scanned_or_image_pdf when the PDF extractor returns tiny text", async () => {
    const pdfExtractor = vi.fn(async () => ({ text: "Jane" }));
    const result = await handleResumeParse(
      {
        filename: "jane.pdf",
        mimeType: "application/pdf",
        base64Content: Buffer.from([0x25, 0x50, 0x44, 0x46]).toString(
          "base64"
        )
      },
      { pdfExtractor }
    );
    expect(result.status).toBe(200);
    const body = result.body as {
      parseDiagnostic: { issueType: string; canRunIntelligence: boolean };
    };
    expect(body.parseDiagnostic.issueType).toBe("scanned_or_image_pdf");
    expect(body.parseDiagnostic.canRunIntelligence).toBe(false);
  });

  it("returns 200 + unsupported_doc_format for legacy .doc", async () => {
    const result = await handleResumeParse({
      filename: "x.doc",
      mimeType: "application/msword",
      base64Content: Buffer.from([0xd0, 0xcf, 0x11, 0xe0]).toString("base64")
    });
    expect(result.status).toBe(200);
    const body = result.body as {
      parseDiagnostic: { issueType: string; canRunIntelligence: boolean };
    };
    expect(body.parseDiagnostic.issueType).toBe("unsupported_doc_format");
    expect(body.parseDiagnostic.canRunIntelligence).toBe(false);
  });
});

describe("POST /api/resume/parse — log discipline", () => {
  it("never includes the extracted text or the resume sentinel in any log entry", async () => {
    const sensitiveResume = `${SECRET_RESUME_LITERAL}\n${SAMPLE_RESUME}`;
    const result = await handleResumeParse({
      filename: "secret.txt",
      mimeType: "text/plain",
      base64Content: base64(sensitiveResume)
    });
    const allLogs = JSON.stringify(result.logs);
    expect(allLogs).not.toContain(SECRET_RESUME_LITERAL);
    expect(allLogs).not.toContain("Jane Doe");
    // Defense-in-depth: the route logs structural fields only.
    expect(allLogs).toContain("characterCount");
  });

  it("never includes raw base64Content in logs", async () => {
    const sensitive = base64(SECRET_RESUME_LITERAL);
    const result = await handleResumeParse({
      filename: "secret.txt",
      mimeType: "text/plain",
      base64Content: sensitive
    });
    const allLogs = JSON.stringify(result.logs);
    expect(allLogs).not.toContain(sensitive);
  });
});
