import {
  RESUME_INTELLIGENCE_PROMPT_VERSION,
  RESUME_INTELLIGENCE_SYSTEM_PROMPT,
  buildResumeIntelligenceUserPrompt,
  llmResumeIntelligenceResponseSchema,
  mapValidatedLlmResponseToOutput
} from "../../src/services/openaiResumeIntelligenceAdapter";
import type { ResumeIntelligenceAdapterOutput } from "../../src/services/resumeIntelligenceService";
import type { ServerConfig } from "../config/env";
import {
  AiProviderError,
  type AiResumeProvider,
  type ResumeIntelligenceProviderInput,
  type ResumeIntelligenceProviderResult
} from "./aiProvider";

/**
 * Azure OpenAI provider. Issues the same prompt + JSON schema as the
 * public OpenAI provider but speaks Azure's URL + auth conventions:
 *
 *   POST  {endpoint}/openai/deployments/{deployment}/chat/completions
 *         ?api-version={apiVersion}
 *   header  api-key: <key>
 *   body    { messages, temperature, response_format, ... }   # no `model`
 *
 * The model is encoded in the deployment name; we never put a
 * `model` field in the body. The deployment must be configured in
 * the Azure tenant to point at a chat-completion-capable model
 * (e.g. gpt-4.1-mini).
 *
 * Safety:
 * - The api-key is read from the server config (loaded from .env or
 *   Azure Key Vault secrets at runtime) and stays server-side.
 * - Errors are wrapped in `AiProviderError` with a generic message
 *   so the route layer can log them safely.
 * - The route layer falls back to deterministic on any throw.
 */
export function createAzureOpenAiResumeProvider(
  config: ServerConfig
): AiResumeProvider {
  return {
    id: "azure_openai",
    async analyzeResume(
      input: ResumeIntelligenceProviderInput
    ): Promise<ResumeIntelligenceProviderResult> {
      const azure = config.azureOpenai;
      if (
        azure.apiKey.length === 0 ||
        azure.endpoint.length === 0 ||
        azure.resumeDeployment.length === 0
      ) {
        throw new AiProviderError(
          "Azure OpenAI is not fully configured (missing endpoint, key, or deployment).",
          "azure_openai"
        );
      }
      const trimmedEndpoint = azure.endpoint.replace(/\/+$/, "");
      const url =
        `${trimmedEndpoint}/openai/deployments/${encodeURIComponent(
          azure.resumeDeployment
        )}/chat/completions?api-version=${encodeURIComponent(azure.apiVersion)}`;

      const body = {
        temperature: 0,
        response_format: { type: "json_object" as const },
        max_tokens: 2400,
        messages: [
          { role: "system" as const, content: RESUME_INTELLIGENCE_SYSTEM_PROMPT },
          {
            role: "user" as const,
            content: buildResumeIntelligenceUserPrompt(input.resumeText)
          }
        ]
      };

      let response: Response;
      try {
        response = await fetch(url, {
          method: "POST",
          headers: {
            // NEVER log this header.
            "api-key": azure.apiKey,
            "Content-Type": "application/json"
          },
          body: JSON.stringify(body)
        });
      } catch (cause) {
        throw new AiProviderError(
          "Azure OpenAI request failed before a response was returned.",
          "azure_openai",
          cause
        );
      }

      if (!response.ok) {
        throw new AiProviderError(
          `Azure OpenAI returned HTTP ${response.status}.`,
          "azure_openai"
        );
      }

      let payload: { choices?: Array<{ message?: { content?: string } }> };
      try {
        payload = (await response.json()) as typeof payload;
      } catch (cause) {
        throw new AiProviderError(
          "Azure OpenAI response was not valid JSON.",
          "azure_openai",
          cause
        );
      }
      const content = payload.choices?.[0]?.message?.content;
      if (!content || typeof content !== "string") {
        throw new AiProviderError(
          "Azure OpenAI response was missing message content.",
          "azure_openai"
        );
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(content);
      } catch (cause) {
        throw new AiProviderError(
          "Azure OpenAI response content was not valid JSON.",
          "azure_openai",
          cause
        );
      }
      const validation = llmResumeIntelligenceResponseSchema.safeParse(parsed);
      if (!validation.success) {
        throw new AiProviderError(
          `Azure OpenAI response failed schema validation: ${validation.error.issues
            .slice(0, 3)
            .map((issue) => `${issue.path.join(".")}:${issue.message}`)
            .join("; ")}`,
          "azure_openai"
        );
      }

      // Use the deployment name as the public model identifier so
      // the UI shows what was actually invoked. The promptVersion
      // matches the OpenAI provider so we can A/B without juggling
      // prompt IDs across providers.
      const output: ResumeIntelligenceAdapterOutput =
        mapValidatedLlmResponseToOutput(
          validation.data,
          azure.resumeDeployment
        );
      // mapValidatedLlmResponseToOutput already sets promptVersion
      // from the OpenAI module's PROMPT_VERSION. Sanity-tag the
      // identifier so downstream debug knows which provider it came
      // from without leaking endpoint/host info.
      output.promptVersion = RESUME_INTELLIGENCE_PROMPT_VERSION;
      return { output, provider: "azure_openai", fallbackUsed: false };
    }
  };
}
