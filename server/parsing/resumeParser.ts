import {
  buildErrorDiagnostic,
  classifyExtractedText,
  type ParseDiagnostic,
  type ParseExtractedFrom
} from "./parseDiagnostic";

/**
 * Server-side resume text extraction.
 *
 * Dispatches to a format-specific parser based on filename
 * extension (with mimeType as a soft hint). Returns the extracted
 * text plus a structured diagnostic so the route layer + frontend
 * can decide whether to run the resume intelligence pipeline.
 *
 * Hard rules:
 * - The extracted text is returned but NEVER logged. Callers (the
 *   route handler in particular) must only log the diagnostic
 *   shape, never the text body.
 * - The parser never throws on a bad input — it returns a
 *   diagnostic explaining what went wrong and what the user can
 *   do about it.
 * - DOC (legacy MS Word) is intentionally unsupported in this
 *   build. The diagnostic explains the recovery path (re-save as
 *   DOCX / PDF / TXT / MD).
 * - OCR is intentionally NOT enabled. Scanned / image PDFs are
 *   returned as `scanned_or_image_pdf`.
 */

export interface ExtractResumeTextInput {
  filename: string;
  mimeType: string;
  buffer: Uint8Array | Buffer;
  /** Override the maximum decoded byte size. Defaults to 5 MB. */
  maxBytes?: number;
  /** Test seam: inject mocked extractors for unit tests. */
  pdfExtractor?: (buffer: Buffer) => Promise<{ text: string }>;
  docxExtractor?: (buffer: Buffer) => Promise<{ value: string }>;
}

export interface ExtractResumeTextResult {
  /** Extracted text. Empty string when extraction failed. */
  extractedText: string;
  diagnostic: ParseDiagnostic;
}

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024; // 5 MB

function detectExtractedFrom(
  filename: string,
  mimeType: string
): ParseExtractedFrom {
  const lowerName = filename.toLowerCase();
  if (lowerName.endsWith(".txt")) return "txt";
  if (lowerName.endsWith(".md") || lowerName.endsWith(".markdown")) return "md";
  if (lowerName.endsWith(".docx")) return "docx";
  if (lowerName.endsWith(".doc") && !lowerName.endsWith(".docx")) return "doc";
  if (lowerName.endsWith(".pdf")) return "pdf";
  // Soft fall-back to mimeType if extension is missing.
  if (mimeType === "application/pdf") return "pdf";
  if (
    mimeType ===
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    return "docx";
  }
  if (mimeType === "application/msword") return "doc";
  if (mimeType === "text/plain") return "txt";
  if (mimeType === "text/markdown") return "md";
  return "unknown";
}

function asBuffer(input: Uint8Array | Buffer): Buffer {
  return Buffer.isBuffer(input) ? input : Buffer.from(input);
}

async function defaultPdfExtractor(
  buffer: Buffer
): Promise<{ text: string }> {
  // pdf-parse v2 exposes a class-based API (different from v1):
  //   new PDFParse({ data: Uint8Array }).getText() → TextResult
  // Dynamic import + the named export keeps esModuleInterop happy
  // across Node versions.
  const mod = await import("pdf-parse");
  const PDFParse = mod.PDFParse;
  // pdf-parse expects Uint8Array (not Buffer) in some paths; both
  // work but we coerce for safety.
  const data = new Uint8Array(buffer);
  const parser = new PDFParse({ data });
  try {
    const result = await parser.getText();
    return { text: typeof result.text === "string" ? result.text : "" };
  } finally {
    await parser.destroy().catch(() => {
      /* destroy() can throw on already-destroyed parsers; ignore */
    });
  }
}

async function defaultDocxExtractor(
  buffer: Buffer
): Promise<{ value: string }> {
  const mammoth = (await import("mammoth")) as unknown as {
    extractRawText: (input: { buffer: Buffer }) => Promise<{ value: string }>;
  };
  const result = await mammoth.extractRawText({ buffer });
  return { value: typeof result.value === "string" ? result.value : "" };
}

export async function extractResumeText(
  input: ExtractResumeTextInput
): Promise<ExtractResumeTextResult> {
  const buffer = asBuffer(input.buffer);
  const source = detectExtractedFrom(input.filename, input.mimeType);
  const maxBytes = input.maxBytes ?? DEFAULT_MAX_BYTES;

  if (buffer.length === 0) {
    return {
      extractedText: "",
      diagnostic: buildErrorDiagnostic("empty_file", source)
    };
  }

  if (buffer.length > maxBytes) {
    return {
      extractedText: "",
      diagnostic: buildErrorDiagnostic("file_too_large", source)
    };
  }

  if (source === "doc") {
    return {
      extractedText: "",
      diagnostic: buildErrorDiagnostic("unsupported_doc_format", source)
    };
  }

  if (source === "txt" || source === "md") {
    const text = buffer.toString("utf-8");
    return {
      extractedText: text,
      diagnostic: classifyExtractedText(text, source)
    };
  }

  if (source === "docx") {
    const docxExtractor = input.docxExtractor ?? defaultDocxExtractor;
    try {
      const result = await docxExtractor(buffer);
      const text = (result.value ?? "").trim();
      return {
        extractedText: text,
        diagnostic: classifyExtractedText(text, source)
      };
    } catch {
      return {
        extractedText: "",
        diagnostic: buildErrorDiagnostic("decode_failed", source)
      };
    }
  }

  if (source === "pdf") {
    const pdfExtractor = input.pdfExtractor ?? defaultPdfExtractor;
    try {
      const result = await pdfExtractor(buffer);
      const text = (result.text ?? "").trim();
      return {
        extractedText: text,
        diagnostic: classifyExtractedText(text, source)
      };
    } catch {
      // pdf-parse can throw on encrypted, corrupted, or extremely
      // unusual PDFs. We fold the error into a clean
      // scanned_or_image_pdf diagnostic so the user sees the same
      // recovery path as the "no selectable text" case.
      return {
        extractedText: "",
        diagnostic: buildErrorDiagnostic("scanned_or_image_pdf", source)
      };
    }
  }

  return {
    extractedText: "",
    diagnostic: buildErrorDiagnostic("unsupported_file_type", source)
  };
}
