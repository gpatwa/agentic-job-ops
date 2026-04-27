import { describe, expect, it } from "vitest";
import { currentSession } from "../src/data/currentSession";
import {
  UnsupportedResumeFileError,
  createResumeUpload,
  parseUploadedResumeFile
} from "../src/services/resumeService";

describe("createResumeUpload", () => {
  it("creates a tenant and user scoped resume record", () => {
    const resume = createResumeUpload(currentSession, {
      fileName: "resume.pdf",
      hasLocalFile: true
    });

    expect(resume.tenantId).toBe(currentSession.tenant.id);
    expect(resume.userId).toBe(currentSession.userId);
    expect(resume.status).toBe("parsed");
    expect(resume.parsedText).toContain("Resume text extraction has not run yet");
  });
});

describe("parseUploadedResumeFile", () => {
  const RESUME_TEXT = `Jane Doe
Senior Product Manager
jane@example.com
+1 555-555-0100

Experience
Led B2B SaaS workflow automation roadmap.`;

  it("reads .txt content directly into parsedText with status=parsed", async () => {
    const file = new File([RESUME_TEXT], "jane.txt", { type: "text/plain" });
    const result = await parseUploadedResumeFile(currentSession, file);
    expect(result.extension).toBe("txt");
    expect(result.extractionPending).toBe(false);
    expect(result.resume.status).toBe("parsed");
    expect(result.resume.originalFileName).toBe("jane.txt");
    expect(result.resume.parsedText).toContain("Jane Doe");
    expect(result.resume.parsedText).toContain("workflow automation");
    expect(result.resume.tenantId).toBe(currentSession.tenant.id);
    expect(result.resume.userId).toBe(currentSession.userId);
    expect(result.resume.fileUrl).toMatch(/^local-upload:\/\/resume\/.+\.txt$/);
  });

  it("reads .md content directly into parsedText with status=parsed", async () => {
    const md = `# Jane Doe\n\n## Experience\n\n- ${RESUME_TEXT}`;
    const file = new File([md], "jane.md", { type: "text/markdown" });
    const result = await parseUploadedResumeFile(currentSession, file);
    expect(result.extension).toBe("md");
    expect(result.extractionPending).toBe(false);
    expect(result.resume.status).toBe("parsed");
    expect(result.resume.parsedText).toContain("# Jane Doe");
  });

  it("stores .pdf metadata with extractionPending=true and status=uploaded", async () => {
    // Use a tiny binary blob — the function should not attempt to decode it.
    const file = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], "jane.pdf", {
      type: "application/pdf"
    });
    const result = await parseUploadedResumeFile(currentSession, file);
    expect(result.extension).toBe("pdf");
    expect(result.extractionPending).toBe(true);
    expect(result.resume.status).toBe("uploaded");
    expect(result.resume.originalFileName).toBe("jane.pdf");
    expect(result.resume.parsedText).toContain(
      "Resume text extraction has not run yet"
    );
    // Defense-in-depth: never store the binary contents.
    expect(result.resume.parsedText).not.toContain("PDF");
  });

  it("stores .docx metadata with extractionPending=true and status=uploaded", async () => {
    const file = new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04])], "jane.docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    });
    const result = await parseUploadedResumeFile(currentSession, file);
    expect(result.extension).toBe("docx");
    expect(result.extractionPending).toBe(true);
    expect(result.resume.status).toBe("uploaded");
  });

  it("stores .doc metadata with extractionPending=true and status=uploaded", async () => {
    const file = new File([new Uint8Array([0xd0, 0xcf, 0x11, 0xe0])], "jane.doc", {
      type: "application/msword"
    });
    const result = await parseUploadedResumeFile(currentSession, file);
    expect(result.extension).toBe("doc");
    expect(result.extractionPending).toBe(true);
    expect(result.resume.status).toBe("uploaded");
  });

  it("normalises uppercase extensions (JANE.PDF) so the binary path still triggers", async () => {
    const file = new File([new Uint8Array([0x25, 0x50])], "JANE.PDF", {
      type: "application/pdf"
    });
    const result = await parseUploadedResumeFile(currentSession, file);
    expect(result.extension).toBe("pdf");
    expect(result.extractionPending).toBe(true);
  });

  it("throws UnsupportedResumeFileError for unsupported extensions like .zip", async () => {
    const file = new File([new Uint8Array([0])], "stuff.zip", {
      type: "application/zip"
    });
    await expect(
      parseUploadedResumeFile(currentSession, file)
    ).rejects.toBeInstanceOf(UnsupportedResumeFileError);
  });
});
