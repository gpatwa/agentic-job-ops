import type { ResumeIntelligenceAdapterOutput } from "../../src/services/resumeIntelligenceService";
import type { AiProviderId, ServerConfig } from "../config/env";
import { getServerConfig } from "../config/env";
import { createOpenAiResumeProvider } from "./openAiProvider";
import { createAzureOpenAiResumeProvider } from "./azureOpenAiProvider";
import { createDeterministicResumeProvider } from "./deterministicProvider";

/**
 * Server-side AI provider boundary. Each implementation knows how
 * to fetch resume intelligence from one specific backend (OpenAI
 * public API, Azure OpenAI, deterministic local fallback).
 *
 * Safety contract:
 * - Implementations must NEVER write the API key, the raw resume
 *   text, or the LLM response body to console / logs / error
 *   messages.
 * - On any error (network, schema validation, rate limit), the
 *   implementation should throw a typed `AiProviderError`. The
 *   route layer catches it and falls back to deterministic so a
 *   transient outage never breaks the user flow.
 */

export interface ResumeIntelligenceProviderInput {
  resumeId: string;
  resumeText: string;
  /**
   * Optional target roles the user has confirmed. The current
   * prompt does not consume this directly but the field is part of
   * the contract so future prompts (or a future model) can use it
   * without an API change.
   */
  targetRoles?: string[];
}

export interface ResumeIntelligenceProviderResult {
  /** Canonical analysis output (matches the deterministic adapter shape). */
  output: ResumeIntelligenceAdapterOutput;
  /** Provider identifier for logging + UI badge. */
  provider: AiProviderId;
  /** True when the deterministic fallback was used instead of the LLM. */
  fallbackUsed: boolean;
}

export interface AiResumeProvider {
  readonly id: AiProviderId;
  analyzeResume(
    input: ResumeIntelligenceProviderInput
  ): Promise<ResumeIntelligenceProviderResult>;
}

export class AiProviderError extends Error {
  constructor(
    message: string,
    public readonly providerId: AiProviderId,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = "AiProviderError";
  }
}

/**
 * Resolve the active LLM provider plus a deterministic fallback.
 * Returns both so the route layer can run the LLM provider first
 * and fall back to the deterministic one if anything goes wrong —
 * no provider is ever "alone" at runtime.
 */
export function getActiveAiResumeProvider(
  config: ServerConfig = getServerConfig()
): { primary: AiResumeProvider; fallback: AiResumeProvider } {
  const fallback = createDeterministicResumeProvider();
  if (config.aiProvider === "openai") {
    return {
      primary: createOpenAiResumeProvider(config),
      fallback
    };
  }
  if (config.aiProvider === "azure_openai") {
    return {
      primary: createAzureOpenAiResumeProvider(config),
      fallback
    };
  }
  return { primary: fallback, fallback };
}
