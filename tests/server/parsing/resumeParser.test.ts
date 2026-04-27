import { describe, expect, it, vi } from "vitest";
import { extractResumeText } from "../../../server/parsing/resumeParser";

/**
 * Resume parser tests.
 *
 * The PDF + DOCX paths are unit-tested with mocked extractors so
 * the test suite stays fast, deterministic, and offline. The
 * actual pdf-parse + mammoth integrations are exercised via the
 * /api/resume/parse e2e tests where it matters that the wire-up
 * works.
 */

const SAMPLE_RESUME_TEXT = `Jane Doe
Senior Product Manager
Remote
jane.doe@example.com
+1 555-555-0100

Experience
Senior Product Manager — DemoLabs — 2022 - 2026
Led B2B SaaS workflow automation roadmap; +20% activation.

Skills
Product Management, Roadmap, Customer Discovery, SQL`;

const RESUME_BYTES_PLACEHOLDER = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d]);

describe("extractResumeText — TXT/MD direct decode", () => {
  it("decodes a UTF-8 TXT buffer and returns good-quality diagnostic for a real resume", async () => {
    const buffer = Buffer.from(SAMPLE_RESUME_TEXT, "utf-8");
    const result = await extractResumeText({
      filename: "jane.txt",
      mimeType: "text/plain",
      buffer
    });
    expect(result.extractedText).toContain("Jane Doe");
    expect(result.diagnostic.status).toBe("good");
    expect(result.diagnostic.extractedFrom).toBe("txt");
    expect(result.diagnostic.canRunIntelligence).toBe(true);
    expect(result.diagnostic.issueType).toBe("ok");
  });

  it("decodes a Markdown buffer (.md) into the same diagnostic shape", async () => {
    const md = `# Jane Doe\n\n${SAMPLE_RESUME_TEXT}`;
    const buffer = Buffer.from(md, "utf-8");
    const result = await extractResumeText({
      filename: "jane.md",
      mimeType: "text/markdown",
      buffer
    });
    expect(result.diagnostic.extractedFrom).toBe("md");
    expect(result.diagnostic.status).toBe("good");
    expect(result.extractedText).toContain("# Jane Doe");
  });
});

describe("extractResumeText — PDF dispatch", () => {
  it("returns a good diagnostic when the PDF extractor returns substantive text", async () => {
    const pdfExtractor = vi.fn(async () => ({ text: SAMPLE_RESUME_TEXT }));
    const result = await extractResumeText({
      filename: "jane.pdf",
      mimeType: "application/pdf",
      buffer: RESUME_BYTES_PLACEHOLDER,
      pdfExtractor
    });
    expect(pdfExtractor).toHaveBeenCalledTimes(1);
    expect(result.extractedText).toContain("Jane Doe");
    expect(result.diagnostic.status).toBe("good");
    expect(result.diagnostic.extractedFrom).toBe("pdf");
    expect(result.diagnostic.canRunIntelligence).toBe(true);
  });

  it("classifies a PDF that yields tiny text as scanned_or_image_pdf", async () => {
    const pdfExtractor = vi.fn(async () => ({ text: "Jane" }));
    const result = await extractResumeText({
      filename: "jane.pdf",
      mimeType: "application/pdf",
      buffer: RESUME_BYTES_PLACEHOLDER,
      pdfExtractor
    });
    expect(result.diagnostic.status).toBe("unreadable");
    expect(result.diagnostic.issueType).toBe("scanned_or_image_pdf");
    expect(result.diagnostic.canRunIntelligence).toBe(false);
    expect(result.diagnostic.likelyCause).toContain("scanned");
    expect(result.diagnostic.recommendedFix).toContain("Paste");
  });

  it("classifies a PDF whose extractor throws as scanned_or_image_pdf (recovery copy)", async () => {
    const pdfExtractor = vi.fn(async () => {
      throw new Error("invalid PDF structure");
    });
    const result = await extractResumeText({
      filename: "jane.pdf",
      mimeType: "application/pdf",
      buffer: RESUME_BYTES_PLACEHOLDER,
      pdfExtractor
    });
    expect(result.extractedText).toBe("");
    expect(result.diagnostic.issueType).toBe("scanned_or_image_pdf");
    expect(result.diagnostic.canRunIntelligence).toBe(false);
  });
});

describe("extractResumeText — DOCX dispatch", () => {
  it("returns a good diagnostic when the DOCX extractor returns substantive text", async () => {
    const docxExtractor = vi.fn(async () => ({ value: SAMPLE_RESUME_TEXT }));
    const result = await extractResumeText({
      filename: "jane.docx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      buffer: Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      docxExtractor
    });
    expect(docxExtractor).toHaveBeenCalledTimes(1);
    expect(result.diagnostic.status).toBe("good");
    expect(result.diagnostic.extractedFrom).toBe("docx");
    expect(result.diagnostic.canRunIntelligence).toBe(true);
  });

  it("classifies a DOCX whose extractor throws as decode_failed", async () => {
    const docxExtractor = vi.fn(async () => {
      throw new Error("not a valid DOCX");
    });
    const result = await extractResumeText({
      filename: "jane.docx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      buffer: Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      docxExtractor
    });
    expect(result.diagnostic.issueType).toBe("decode_failed");
    expect(result.diagnostic.canRunIntelligence).toBe(false);
  });
});

describe("extractResumeText — DOC unsupported branch", () => {
  it("returns unsupported_doc_format for legacy .doc files without invoking any extractor", async () => {
    const docxExtractor = vi.fn(async () => ({ value: "should not be called" }));
    const result = await extractResumeText({
      filename: "jane.doc",
      mimeType: "application/msword",
      buffer: Buffer.from([0xd0, 0xcf, 0x11, 0xe0]),
      docxExtractor
    });
    expect(docxExtractor).not.toHaveBeenCalled();
    expect(result.diagnostic.issueType).toBe("unsupported_doc_format");
    expect(result.diagnostic.recommendedFix).toContain("DOCX");
    expect(result.extractedText).toBe("");
  });
});

describe("extractResumeText — guards", () => {
  it("returns empty_file when the buffer is empty", async () => {
    const result = await extractResumeText({
      filename: "x.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.alloc(0)
    });
    expect(result.diagnostic.issueType).toBe("empty_file");
    expect(result.diagnostic.canRunIntelligence).toBe(false);
  });

  it("returns file_too_large when the buffer exceeds maxBytes", async () => {
    const result = await extractResumeText({
      filename: "x.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.alloc(200),
      maxBytes: 100
    });
    expect(result.diagnostic.issueType).toBe("file_too_large");
    expect(result.diagnostic.canRunIntelligence).toBe(false);
  });

  it("returns unsupported_file_type for unknown extensions", async () => {
    const result = await extractResumeText({
      filename: "stuff.zip",
      mimeType: "application/zip",
      buffer: Buffer.from([0x50, 0x4b])
    });
    expect(result.diagnostic.issueType).toBe("unsupported_file_type");
    expect(result.diagnostic.extractedFrom).toBe("unknown");
  });
});

describe("extractResumeText — integration with real pdf-parse + mammoth", () => {
  it("PDF: extracts selectable text from a pdfkit-generated PDF", async () => {
    const PDFDocument = (await import("pdfkit")).default;
    const buffers: Buffer[] = [];
    const doc = new PDFDocument();
    await new Promise<void>((resolve, reject) => {
      doc.on("data", (chunk: Buffer) => buffers.push(chunk));
      doc.on("end", () => resolve());
      doc.on("error", reject);
      doc.fontSize(12).text(SAMPLE_RESUME_TEXT);
      doc.end();
    });
    const buffer = Buffer.concat(buffers);
    const result = await extractResumeText({
      filename: "jane.pdf",
      mimeType: "application/pdf",
      buffer
    });
    expect(result.diagnostic.extractedFrom).toBe("pdf");
    expect(result.extractedText).toContain("Jane Doe");
    expect(result.extractedText).toContain("jane.doe@example.com");
    expect(result.diagnostic.canRunIntelligence).toBe(true);
  }, 30_000);

  it("DOCX: extracts text from a docx-generated DOCX file", async () => {
    const docxLib = await import("docx");
    const { Document, Packer, Paragraph } = docxLib;
    const doc = new Document({
      sections: [
        {
          properties: {},
          children: SAMPLE_RESUME_TEXT.split("\n").map(
            (line) => new Paragraph({ text: line })
          )
        }
      ]
    });
    const buffer = await Packer.toBuffer(doc);
    const result = await extractResumeText({
      filename: "jane.docx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      buffer
    });
    expect(result.diagnostic.extractedFrom).toBe("docx");
    expect(result.extractedText).toContain("Jane Doe");
    expect(result.extractedText).toContain("jane.doe@example.com");
    expect(result.diagnostic.status).toBe("good");
    expect(result.diagnostic.canRunIntelligence).toBe(true);
  }, 30_000);
});
