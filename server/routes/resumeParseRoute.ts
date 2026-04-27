import { z } from "zod";
import {
  extractResumeText,
  type ExtractResumeTextInput
} from "../parsing/resumeParser";
import type { ParseDiagnostic } from "../parsing/parseDiagnostic";
import { redactErrorForLog } from "../security/redaction";
import type { RouteLogEntry } from "./resumeIntelligenceRoute";

/**
 * POST /api/resume/parse
 *
 * Body:
 *   {
 *     filename:         string (1..256)
 *     mimeType:         string
 *     base64Content:    string (Base64-encoded raw file bytes)
 *   }
 *
 * Response (200):
 *   {
 *     extractedText:    string  (may be empty when diagnostic.canRunIntelligence is false)
 *     parseDiagnostic:  ParseDiagnostic
 *   }
 *
 * Logging contract:
 * - The request body is NEVER written to logs in full.
 * - The extracted text is NEVER written to logs (it can contain
 *   PII / candidate facts).
 * - Only structural fields are logged (filename length, decoded
 *   byte count, source, status, issueType, character count,
 *   signal counts).
 */

export const resumeParseRequestSchema = z.object({
  filename: z.string().trim().min(1).max(256),
  mimeType: z.string().trim().min(1).max(256),
  base64Content: z
    .string()
    // Loose Base64 shape — the strict decode test happens below
    // because zod's regex would balloon for huge payloads.
    .min(4)
    .max(10 * 1024 * 1024) // ~7.5 MB raw after decode
});

export type ResumeParseRequest = z.infer<typeof resumeParseRequestSchema>;

export interface ResumeParseResponseBody {
  extractedText: string;
  parseDiagnostic: ParseDiagnostic;
}

export interface ResumeParseRouteResult {
  status: number;
  body: ResumeParseResponseBody | { error: string; details?: unknown };
  logs: RouteLogEntry[];
}

export interface HandleResumeParseOptions {
  /** Test seam: inject mocked extractors. */
  pdfExtractor?: ExtractResumeTextInput["pdfExtractor"];
  docxExtractor?: ExtractResumeTextInput["docxExtractor"];
  /** Override the per-request max byte size. */
  maxBytes?: number;
}

function decodeBase64Strict(input: string): Buffer | null {
  // Buffer.from(..., "base64") accepts garbage and silently
  // returns truncated/empty buffers. Validate first.
  if (input.length === 0) return null;
  // Strict alphabet check — Base64 is A-Z/a-z/0-9/+/=, optionally
  // padded. Allow whitespace which Buffer ignores.
  const cleaned = input.replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(cleaned)) {
    return null;
  }
  try {
    return Buffer.from(cleaned, "base64");
  } catch {
    return null;
  }
}

export async function handleResumeParse(
  rawBody: unknown,
  options: HandleResumeParseOptions = {}
): Promise<ResumeParseRouteResult> {
  const validation = resumeParseRequestSchema.safeParse(rawBody);
  if (!validation.success) {
    return {
      status: 400,
      body: {
        error: "Invalid request body",
        details: validation.error.issues.slice(0, 3).map((issue) => ({
          path: issue.path.join("."),
          message: issue.message
        }))
      },
      logs: [
        {
          level: "warn",
          message: "resume_parse.validation_failed",
          fields: { issueCount: validation.error.issues.length }
        }
      ]
    };
  }

  const input = validation.data;
  const buffer = decodeBase64Strict(input.base64Content);
  if (!buffer) {
    return {
      status: 400,
      body: { error: "base64Content is not valid Base64." },
      logs: [
        {
          level: "warn",
          message: "resume_parse.base64_decode_failed",
          fields: { filenameLen: input.filename.length }
        }
      ]
    };
  }

  try {
    const result = await extractResumeText({
      filename: input.filename,
      mimeType: input.mimeType,
      buffer,
      maxBytes: options.maxBytes,
      pdfExtractor: options.pdfExtractor,
      docxExtractor: options.docxExtractor
    });
    return {
      status: 200,
      body: {
        extractedText: result.extractedText,
        parseDiagnostic: result.diagnostic
      },
      logs: [
        {
          level: "info",
          message: "resume_parse.completed",
          fields: {
            filenameLen: input.filename.length,
            byteLen: buffer.length,
            source: result.diagnostic.extractedFrom,
            status: result.diagnostic.status,
            issueType: result.diagnostic.issueType,
            characterCount: result.diagnostic.characterCount,
            signalCount: Object.values(result.diagnostic.signalsDetected).filter(
              Boolean
            ).length,
            canRunIntelligence: result.diagnostic.canRunIntelligence
          }
        }
      ]
    };
  } catch (error) {
    const redacted = redactErrorForLog(error);
    return {
      status: 500,
      body: { error: "Resume parsing is unavailable." },
      logs: [
        {
          level: "warn",
          message: "resume_parse.crashed",
          fields: {
            filenameLen: input.filename.length,
            byteLen: buffer.length,
            errorName: redacted.name,
            errorMessage: redacted.message
          }
        }
      ]
    };
  }
}
