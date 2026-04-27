import { z } from "zod";
import {
  AiProviderError,
  type AiResumeProvider,
  getActiveAiResumeProvider
} from "../ai/aiProvider";
import type { AiProviderId } from "../config/env";
import type { ResumeIntelligenceAdapterOutput } from "../../src/services/resumeIntelligenceService";
import { redactErrorForLog } from "../security/redaction";

/**
 * POST /api/resume-intelligence
 *
 * Body:
 *   {
 *     resumeId:    string (1..256)
 *     resumeText:  string (>=20 chars, <=200_000)
 *     userId?:     string
 *     sessionId?:  string
 *     targetRoles?: string[]
 *   }
 *
 * Response (200):
 *   {
 *     extractionMode:  "llm" | "deterministic"
 *     provider:        "openai" | "azure_openai" | "deterministic"
 *     modelName:       string
 *     promptVersion:   string
 *     fallbackUsed:    boolean   // true when the LLM provider threw and
 *                                  the deterministic fallback ran
 *     report:          ResumeIntelligenceAdapterOutput
 *   }
 *
 * Response (400) — validation error.
 * Response (500) — only when even the deterministic fallback throws,
 *                  which shouldn't happen for any reasonable input.
 *
 * Logging contract:
 * - The request body is NEVER written to logs in full. Only
 *   structural metadata (resumeId hash length, text length,
 *   targetRole count) is recorded.
 * - The response body is NEVER written to logs.
 * - Errors are passed through `redactErrorForLog` so any stray
 *   secret or content embedded in an error message is stripped.
 */

export const resumeIntelligenceRequestSchema = z.object({
  resumeId: z.string().trim().min(1).max(256),
  resumeText: z.string().min(20).max(200_000),
  userId: z.string().trim().max(256).optional(),
  sessionId: z.string().trim().max(256).optional(),
  targetRoles: z.array(z.string().trim().min(1)).max(20).optional()
});

export type ResumeIntelligenceRequest = z.infer<
  typeof resumeIntelligenceRequestSchema
>;

export interface ResumeIntelligenceResponseBody {
  extractionMode: "llm" | "deterministic";
  provider: AiProviderId;
  modelName: string;
  promptVersion: string;
  fallbackUsed: boolean;
  report: ResumeIntelligenceAdapterOutput;
}

export interface RouteLogEntry {
  level: "info" | "warn";
  message: string;
  fields: Record<string, string | number | boolean>;
}

export interface ResumeIntelligenceRouteResult {
  status: number;
  body:
    | ResumeIntelligenceResponseBody
    | { error: string; details?: unknown };
  logs: RouteLogEntry[];
}

export interface HandleResumeIntelligenceOptions {
  /** Override the provider pair for tests. */
  providers?: { primary: AiResumeProvider; fallback: AiResumeProvider };
}

/**
 * Pure handler. Takes a parsed (untyped) JSON body, returns the
 * status + body the HTTP layer should send, plus a list of
 * structural log entries the HTTP layer should emit.
 */
export async function handleResumeIntelligence(
  rawBody: unknown,
  options: HandleResumeIntelligenceOptions = {}
): Promise<ResumeIntelligenceRouteResult> {
  const validation = resumeIntelligenceRequestSchema.safeParse(rawBody);
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
          message: "resume_intelligence.validation_failed",
          fields: {
            issueCount: validation.error.issues.length
          }
        }
      ]
    };
  }

  const input = validation.data;
  const { primary, fallback } =
    options.providers ?? getActiveAiResumeProvider();

  const baseFields: Record<string, string | number | boolean> = {
    resumeIdLen: input.resumeId.length,
    textLen: input.resumeText.length,
    targetRolesCount: input.targetRoles?.length ?? 0,
    primaryProvider: primary.id,
    fallbackProvider: fallback.id
  };

  try {
    const result = await primary.analyzeResume(input);
    return {
      status: 200,
      body: {
        extractionMode: result.output.extractionMode,
        provider: result.provider,
        modelName: result.output.modelName,
        promptVersion: result.output.promptVersion,
        fallbackUsed: result.fallbackUsed,
        report: result.output
      },
      logs: [
        {
          level: "info",
          message: "resume_intelligence.analyzed",
          fields: {
            ...baseFields,
            usedProvider: result.provider,
            extractionMode: result.output.extractionMode,
            atsRiskLevel: result.output.atsRiskLevel,
            atsRiskScore: Math.round(result.output.atsRiskScore),
            fallbackUsed: result.fallbackUsed
          }
        }
      ]
    };
  } catch (primaryError) {
    // The primary provider failed — log a redacted error and try
    // the deterministic fallback. The fallback should never throw
    // for any input that passed validation.
    const redacted = redactErrorForLog(primaryError);
    const primaryLog: RouteLogEntry = {
      level: "warn",
      message: "resume_intelligence.primary_failed",
      fields: {
        ...baseFields,
        errorName: redacted.name,
        errorMessage: redacted.message
      }
    };

    if (primary.id === fallback.id) {
      // Already on the deterministic provider — no recovery.
      return {
        status: 500,
        body: { error: "Resume intelligence is unavailable." },
        logs: [
          primaryLog,
          {
            level: "warn",
            message: "resume_intelligence.deterministic_failed",
            fields: baseFields
          }
        ]
      };
    }

    try {
      const fallbackResult = await fallback.analyzeResume(input);
      return {
        status: 200,
        body: {
          extractionMode: fallbackResult.output.extractionMode,
          provider: fallbackResult.provider,
          modelName: fallbackResult.output.modelName,
          promptVersion: fallbackResult.output.promptVersion,
          // Mark the fallback path explicitly so the UI can show it.
          fallbackUsed: true,
          report: fallbackResult.output
        },
        logs: [
          primaryLog,
          {
            level: "info",
            message: "resume_intelligence.fallback_succeeded",
            fields: {
              ...baseFields,
              usedProvider: fallbackResult.provider,
              fallbackUsed: true
            }
          }
        ]
      };
    } catch (fallbackError) {
      const redactedFallback = redactErrorForLog(fallbackError);
      return {
        status: 500,
        body: { error: "Resume intelligence is unavailable." },
        logs: [
          primaryLog,
          {
            level: "warn",
            message: "resume_intelligence.fallback_failed",
            fields: {
              ...baseFields,
              errorName: redactedFallback.name,
              errorMessage: redactedFallback.message
            }
          }
        ]
      };
    }
  }
}

// Re-export so the entrypoint can know about the typed error class
// without importing from deeper modules.
export { AiProviderError };
