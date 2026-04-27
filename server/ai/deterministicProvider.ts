import { createDeterministicResumeIntelligenceAdapter } from "../../src/services/resumeIntelligenceService";
import type {
  AiResumeProvider,
  ResumeIntelligenceProviderInput,
  ResumeIntelligenceProviderResult
} from "./aiProvider";

/**
 * Deterministic provider — wraps the existing in-process resume
 * intelligence adapter. Always available, never reaches the
 * network, returns identical output shape to the LLM providers.
 *
 * This is the safety net every other provider falls back to, so it
 * must never fail under any input that passes the route's
 * validation. (The deterministic adapter itself doesn't throw on
 * empty/short text — it just returns low-confidence output.)
 */
export function createDeterministicResumeProvider(): AiResumeProvider {
  const adapter = createDeterministicResumeIntelligenceAdapter();
  return {
    id: "deterministic",
    async analyzeResume(
      input: ResumeIntelligenceProviderInput
    ): Promise<ResumeIntelligenceProviderResult> {
      const output = await adapter.analyze({
        resume: {
          // Synthetic Resume record — only `parsedText` is read by
          // the deterministic adapter. The other fields are
          // populated for schema-shape compatibility.
          id: input.resumeId || "resume_inflight",
          tenantId: "server",
          userId: "server",
          originalFileName: "server-input.txt",
          fileUrl: "server://inflight",
          parsedText: input.resumeText,
          status: "parsed",
          createdAt: new Date().toISOString()
        }
      });
      return {
        output,
        provider: "deterministic",
        fallbackUsed: false
      };
    }
  };
}
