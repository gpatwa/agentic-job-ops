import type { ResumeIntelligenceProvider } from "../models/domain";
import type { ResumeIntelligenceAdapterOutput } from "./resumeIntelligenceService";

/**
 * Frontend client for the AI API server (`POST /api/resume-intelligence`).
 *
 * Behaviour:
 * - Calls the backend with a tight timeout. The API server is the
 *   only thing that ever sees the OpenAI / Azure OpenAI key.
 * - Treats network errors, timeouts, and any non-2xx response as
 *   "API unavailable" and rejects with `ApiResumeIntelligenceUnavailableError`.
 *   The caller (the API-backed adapter) is responsible for the
 *   deterministic fallback.
 * - Never logs the resume text. Never logs the response body.
 */

const DEFAULT_PATH = "/api/resume-intelligence";
const DEFAULT_TIMEOUT_MS = 15_000;

export class ApiResumeIntelligenceUnavailableError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = "ApiResumeIntelligenceUnavailableError";
  }
}

export interface ApiResumeIntelligenceRequest {
  resumeId: string;
  resumeText: string;
  userId?: string;
  sessionId?: string;
  targetRoles?: string[];
}

export interface ApiResumeIntelligenceResponse {
  extractionMode: "llm" | "deterministic";
  provider: ResumeIntelligenceProvider;
  modelName: string;
  promptVersion: string;
  fallbackUsed: boolean;
  /**
   * Canonical analysis output. Shape matches
   * `ResumeIntelligenceAdapterOutput` so the adapter can return it
   * directly with no remapping.
   */
  report: ResumeIntelligenceAdapterOutput;
}

export interface ApiClientOptions {
  /** Override the request path. Defaults to "/api/resume-intelligence". */
  path?: string;
  /** Abort after this many ms. Defaults to 15s. */
  timeoutMs?: number;
  /** Inject a fetch implementation (used by tests). */
  fetchImpl?: typeof fetch;
  /** Inject an AbortController constructor (used by tests). */
  abortControllerCtor?: typeof AbortController;
}

/**
 * Issue the HTTP call. Resolves with the typed response body on
 * 2xx, rejects with `ApiResumeIntelligenceUnavailableError` on any
 * other outcome (timeout, network failure, 4xx, 5xx, malformed JSON).
 */
export async function callResumeIntelligenceApi(
  request: ApiResumeIntelligenceRequest,
  options: ApiClientOptions = {}
): Promise<ApiResumeIntelligenceResponse> {
  const path = options.path ?? DEFAULT_PATH;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImpl =
    options.fetchImpl ?? (typeof fetch !== "undefined" ? fetch : undefined);
  if (!fetchImpl) {
    throw new ApiResumeIntelligenceUnavailableError(
      "No fetch implementation available."
    );
  }

  const AbortControllerCtor =
    options.abortControllerCtor ??
    (typeof AbortController !== "undefined" ? AbortController : undefined);
  const controller = AbortControllerCtor ? new AbortControllerCtor() : null;
  const timer = controller
    ? setTimeout(() => controller.abort(), timeoutMs)
    : null;

  let response: Response;
  try {
    response = await fetchImpl(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal: controller?.signal
    });
  } catch (cause) {
    throw new ApiResumeIntelligenceUnavailableError(
      "Resume intelligence API request failed before a response was returned.",
      cause
    );
  } finally {
    if (timer) clearTimeout(timer);
  }

  if (!response.ok) {
    throw new ApiResumeIntelligenceUnavailableError(
      `Resume intelligence API returned HTTP ${response.status}.`
    );
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (cause) {
    throw new ApiResumeIntelligenceUnavailableError(
      "Resume intelligence API response was not valid JSON.",
      cause
    );
  }

  if (!isApiResponseShape(body)) {
    throw new ApiResumeIntelligenceUnavailableError(
      "Resume intelligence API response shape was unexpected."
    );
  }

  return body;
}

function isApiResponseShape(value: unknown): value is ApiResumeIntelligenceResponse {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.extractionMode === "string" &&
    typeof candidate.provider === "string" &&
    typeof candidate.modelName === "string" &&
    typeof candidate.promptVersion === "string" &&
    typeof candidate.fallbackUsed === "boolean" &&
    typeof candidate.report === "object" &&
    candidate.report !== null
  );
}

/**
 * Lightweight status probe — the frontend uses this to label the UI
 * accurately at startup ("API reachable, configured for OpenAI" vs.
 * "deterministic only"). Failures are silent; callers fall back.
 */
export interface ApiAiStatus {
  provider: ResumeIntelligenceProvider;
  configured: boolean;
  fallbackAvailable: boolean;
  resumeModel: string;
  jobModel: string;
}

export async function fetchAiStatus(
  options: ApiClientOptions = {}
): Promise<ApiAiStatus | null> {
  const path = options.path ?? "/api/ai/status";
  const fetchImpl =
    options.fetchImpl ?? (typeof fetch !== "undefined" ? fetch : undefined);
  if (!fetchImpl) return null;
  try {
    const response = await fetchImpl(path);
    if (!response.ok) return null;
    const body = (await response.json()) as ApiAiStatus;
    return body;
  } catch {
    return null;
  }
}

/**
 * AI round-trip probe. Snapshot of `/api/ai/probe` with the
 * categorised error model (timeout / http_4xx / etc.) so the
 * Admin diagnostics + the customer-facing "AI unavailable" card
 * can carry the actionable detail.
 */
export type ApiAiProbeErrorCategory =
  | "not_configured"
  | "network"
  | "timeout"
  | "http_4xx"
  | "http_5xx"
  | "json_parse"
  | "unknown";

export interface ApiAiProbe {
  ok: boolean;
  provider: ResumeIntelligenceProvider;
  model: string;
  latencyMs: number;
  observedAt: string;
  errorCategory?: ApiAiProbeErrorCategory;
  errorDetail?: string;
  cached: boolean;
  staleAfterMs: number;
}

/**
 * Issue a probe via `/api/ai/probe`. Returns null when the API
 * server is unreachable — callers should treat that as
 * "AI service offline" with no specific category. Defaults to
 * the cached server-side result; pass `force: true` to bypass.
 */
export async function fetchAiProbe(
  options: ApiClientOptions & { force?: boolean } = {}
): Promise<ApiAiProbe | null> {
  const basePath = options.path ?? "/api/ai/probe";
  const path = options.force
    ? `${basePath}?force=1`
    : basePath;
  const fetchImpl =
    options.fetchImpl ?? (typeof fetch !== "undefined" ? fetch : undefined);
  if (!fetchImpl) return null;
  try {
    const response = await fetchImpl(path);
    if (!response.ok) return null;
    const body = (await response.json()) as ApiAiProbe;
    return body;
  } catch {
    return null;
  }
}
