import { createOpenAIResumeIntelligenceAdapter } from "../../src/services/openaiResumeIntelligenceAdapter";
import type { ServerConfig } from "../config/env";
import { redactErrorForLog } from "../security/redaction";
import {
  AiProviderError,
  type AiProbeResult,
  type AiResumeProvider,
  type ResumeIntelligenceProviderInput,
  type ResumeIntelligenceProviderResult
} from "./aiProvider";

const OPENAI_DEFAULT_ENDPOINT =
  "https://api.openai.com/v1/chat/completions";

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
    },
    async probe(): Promise<AiProbeResult> {
      const observedAt = new Date().toISOString();
      if (!config.openai.apiKey || config.openai.apiKey.trim().length === 0) {
        return {
          ok: false,
          provider: "openai",
          model: config.openai.resumeModel,
          latencyMs: 0,
          observedAt,
          errorCategory: "not_configured",
          errorDetail: "OPENAI_API_KEY is not set."
        };
      }
      const startedAt = Date.now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      let response: Response;
      try {
        response = await fetch(OPENAI_DEFAULT_ENDPOINT, {
          method: "POST",
          headers: {
            // NEVER log this header.
            Authorization: `Bearer ${config.openai.apiKey}`,
            "Content-Type": "application/json"
          },
          // Same request shape as the real call (response_format
          // + max_completion_tokens) so a parameter-shape bug
          // trips THIS request too — that's the whole point of
          // the probe.
          body: JSON.stringify({
            model: config.openai.resumeModel,
            temperature: 0,
            response_format: { type: "json_object" as const },
            max_completion_tokens: 20,
            messages: [
              {
                role: "system" as const,
                content:
                  "You output JSON only. Reply with the JSON object {\"ok\":true}."
              },
              { role: "user" as const, content: "ping" }
            ]
          }),
          signal: controller.signal
        });
      } catch (cause) {
        clearTimeout(timer);
        const aborted =
          cause instanceof Error &&
          (cause.name === "AbortError" || cause.message.includes("aborted"));
        return {
          ok: false,
          provider: "openai",
          model: config.openai.resumeModel,
          latencyMs: Date.now() - startedAt,
          observedAt,
          errorCategory: aborted ? "timeout" : "network",
          errorDetail: aborted
            ? "OpenAI did not respond within 8 s."
            : redactErrorForLog(cause).message
        };
      }
      clearTimeout(timer);
      const latencyMs = Date.now() - startedAt;
      if (!response.ok) {
        let detail = `HTTP ${response.status}`;
        try {
          const text = await response.text();
          // Trim + redact + truncate.
          detail = `HTTP ${response.status}: ${
            redactErrorForLog(new Error(text.slice(0, 240))).message
          }`;
        } catch {
          /* keep generic detail */
        }
        return {
          ok: false,
          provider: "openai",
          model: config.openai.resumeModel,
          latencyMs,
          observedAt,
          errorCategory:
            response.status >= 500 ? "http_5xx" : "http_4xx",
          errorDetail: detail
        };
      }
      try {
        await response.json();
      } catch {
        return {
          ok: false,
          provider: "openai",
          model: config.openai.resumeModel,
          latencyMs,
          observedAt,
          errorCategory: "json_parse",
          errorDetail: "OpenAI response was not valid JSON."
        };
      }
      return {
        ok: true,
        provider: "openai",
        model: config.openai.resumeModel,
        latencyMs,
        observedAt
      };
    }
  };
}
