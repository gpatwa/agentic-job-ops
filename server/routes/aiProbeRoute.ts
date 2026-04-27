import { runAiProbe, type RunAiProbeOptions } from "../ai/aiProbe";
import type { AiProbeResult } from "../ai/aiProvider";

/**
 * GET /api/ai/probe
 *
 * Returns the cached LLM round-trip result, or issues a fresh
 * probe if the cache is empty or `?force=1` is passed.
 *
 * Response shape:
 *   {
 *     ok:             boolean;
 *     provider:       "openai" | "azure_openai" | "deterministic";
 *     model:          string;
 *     latencyMs:      number;
 *     observedAt:     ISO timestamp;
 *     errorCategory?: "not_configured" | "network" | "timeout"
 *                   | "http_4xx" | "http_5xx" | "json_parse" | "unknown";
 *     errorDetail?:   string  (operator-friendly, redacted);
 *     cached:         boolean (this hit the cache);
 *     staleAfterMs:   number  (ms until cache TTL).
 *   }
 *
 * No secrets in this body — `errorDetail` runs through
 * `redactErrorForLog` upstream, and the model field carries the
 * deployment name (which is intentionally exposed by the existing
 * /api/ai/status endpoint anyway).
 */

export interface AiProbeResponseBody extends AiProbeResult {
  cached: boolean;
  staleAfterMs: number;
}

export interface AiProbeRouteResult {
  status: number;
  body: AiProbeResponseBody;
}

export async function handleAiProbe(
  options: { force?: boolean; runOptions?: RunAiProbeOptions } = {}
): Promise<AiProbeRouteResult> {
  const { result, cached, staleAfterMs } = await runAiProbe({
    force: options.force,
    ...(options.runOptions ?? {})
  });
  return {
    status: 200,
    body: { ...result, cached, staleAfterMs }
  };
}
