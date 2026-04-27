import { createOpenAIResumeIntelligenceAdapter } from "../../src/services/openaiResumeIntelligenceAdapter";
import type { ServerConfig } from "../config/env";
import {
  AiProviderError,
  type AiResumeProvider,
  type ResumeIntelligenceProviderInput,
  type ResumeIntelligenceProviderResult
} from "./aiProvider";

/**
 * OpenAI public API provider. Wraps the existing
 * `createOpenAIResumeIntelligenceAdapter` so the prompt + schema +
 * defense-in-depth post-processing (fitLevel enforcement, cross-
 * bucket dedupe, weak-evidence demotion) all run server-side
 * without code duplication.
 *
 * Safety:
 * - The API key is read from the server config (loaded from .env or
 *   process.env / Key Vault secrets in production) and is never
 *   sent to the client.
 * - The adapter never logs the resume text or the API key (see its
 *   own dedicated test in tests/openaiResumeIntelligenceAdapter.test.ts).
 * - On any failure (missing key, non-2xx, malformed JSON, schema
 *   validation), the adapter throws `OpenAIResumeIntelligenceAdapterError`.
 *   This provider rethrows as `AiProviderError` so the route layer
 *   uniformly catches and falls back to deterministic.
 */
export function createOpenAiResumeProvider(
  config: ServerConfig
): AiResumeProvider {
  const adapter = createOpenAIResumeIntelligenceAdapter({
    apiKey: config.openai.apiKey,
    model: config.openai.resumeModel
  });
  return {
    id: "openai",
    async analyzeResume(
      input: ResumeIntelligenceProviderInput
    ): Promise<ResumeIntelligenceProviderResult> {
      try {
        const output = await adapter.analyze({
          resume: {
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
        return { output, provider: "openai", fallbackUsed: false };
      } catch (cause) {
        // Wrap the error with a generic message — the route layer
        // logs only the redacted error name + message, never the
        // raw payload.
        throw new AiProviderError(
          "OpenAI resume intelligence call failed",
          "openai",
          cause
        );
      }
    }
  };
}
