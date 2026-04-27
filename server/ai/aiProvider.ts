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
  /**
   * Cheap liveness check — a few-token round-trip to the
   * configured backend using the SAME request shape (headers,
   * response_format, max_completion_tokens) the real call uses,
   * so a parameter-shape bug like the recent `max_tokens` →
   * `max_completion_tokens` migration trips this immediately.
   *
   * Implementations must NEVER throw — every failure is folded
   * into an `AiProbeResult` with `ok: false` and an
   * `errorCategory`. The orchestrator caches the result so the
   * Admin page can poll without burning the bill.
   */
  probe(): Promise<AiProbeResult>;
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
 * Categorised LLM round-trip outcome. Caused by a real (tiny)
 * call to the provider — not by inspecting local env. The
 * categories mirror the failure modes operators care about:
 *
 *   not_configured  — provider has no credentials at all
 *   network         — DNS / TLS / connection refused
 *   timeout         — provider didn't return within the budget
 *   http_4xx        — provider rejected the request shape (the
 *                     class of bug that hid `max_tokens` vs.
 *                     `max_completion_tokens` for weeks)
 *   http_5xx        — provider returned 5xx
 *   json_parse      — response body wasn't valid JSON
 *   unknown         — anything else, with the redacted error
 *                     category surfaced to the operator
 *
 * Successful probes carry latency for SLO charting.
 */
export type AiProbeErrorCategory =
  | "not_configured"
  | "network"
  | "timeout"
  | "http_4xx"
  | "http_5xx"
  | "json_parse"
  | "unknown";

export interface AiProbeResult {
  ok: boolean;
  provider: AiProviderId;
  /** Model / deployment identifier the probe ran against. */
  model: string;
  /** Wall-clock round-trip in ms. 0 for the deterministic probe. */
  latencyMs: number;
  /** ISO timestamp this result was produced. */
  observedAt: string;
  /** Set on `ok=false`. */
  errorCategory?: AiProbeErrorCategory;
  /**
   * Operator-friendly one-line hint for `ok=false`. Goes through
   * `redactErrorForLog` first so any secret-shaped substring is
   * stripped. Safe to render in Admin/System AI Diagnostics; not
   * shown to customers.
   */
  errorDetail?: string;
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
