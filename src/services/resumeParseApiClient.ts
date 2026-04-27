/**
 * Frontend client for the resume parsing API
 * (`POST /api/resume/parse`).
 *
 * Behaviour:
 * - Calls the backend with a generous-but-bounded timeout. The
 *   API server is the only thing that runs `pdf-parse` / `mammoth`;
 *   the browser bundle stays small.
 * - Treats any network error, timeout, or non-2xx response as
 *   "API unavailable" and rejects with `ApiResumeParseUnavailableError`.
 *   Callers (the upload handler) silently fall back to the
 *   placeholder-text path so the user sees the existing parsing-
 *   issue card with paste-text recovery.
 * - Never logs the file content or the extracted text.
 */

const DEFAULT_PATH = "/api/resume/parse";
const DEFAULT_TIMEOUT_MS = 30_000;

export interface ApiParseSignals {
  hasEmail: boolean;
  hasPhone: boolean;
  hasLikelyName: boolean;
  hasRoleTitle: boolean;
  hasCompany: boolean;
  hasDates: boolean;
  hasSkills: boolean;
}

export type ApiParseStatus = "good" | "partial" | "poor" | "unreadable";

export type ApiParseExtractedFrom =
  | "txt"
  | "md"
  | "pdf"
  | "docx"
  | "doc"
  | "unknown";

export type ApiParseIssueType =
  | "ok"
  | "scanned_or_image_pdf"
  | "too_little_text"
  | "unsupported_doc_format"
  | "unsupported_file_type"
  | "decode_failed"
  | "file_too_large"
  | "empty_file";

export interface ApiParseDiagnostic {
  status: ApiParseStatus;
  issueType: ApiParseIssueType;
  characterCount: number;
  extractedFrom: ApiParseExtractedFrom;
  signalsDetected: ApiParseSignals;
  likelyCause: string;
  userExplanation: string;
  recommendedFix: string;
  canRunIntelligence: boolean;
  canRunLimitedAnalysis: boolean;
}

export interface ApiResumeParseRequest {
  filename: string;
  mimeType: string;
  base64Content: string;
}

export interface ApiResumeParseResponse {
  extractedText: string;
  parseDiagnostic: ApiParseDiagnostic;
}

export interface ParseApiClientOptions {
  path?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  abortControllerCtor?: typeof AbortController;
}

export class ApiResumeParseUnavailableError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "ApiResumeParseUnavailableError";
  }
}

export async function callResumeParseApi(
  request: ApiResumeParseRequest,
  options: ParseApiClientOptions = {}
): Promise<ApiResumeParseResponse> {
  const path = options.path ?? DEFAULT_PATH;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImpl =
    options.fetchImpl ?? (typeof fetch !== "undefined" ? fetch : undefined);
  if (!fetchImpl) {
    throw new ApiResumeParseUnavailableError("No fetch implementation available.");
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
    throw new ApiResumeParseUnavailableError(
      "Resume parse API request failed before a response was returned.",
      cause
    );
  } finally {
    if (timer) clearTimeout(timer);
  }
  if (!response.ok) {
    throw new ApiResumeParseUnavailableError(
      `Resume parse API returned HTTP ${response.status}.`
    );
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch (cause) {
    throw new ApiResumeParseUnavailableError(
      "Resume parse API response was not valid JSON.",
      cause
    );
  }
  if (!isApiResponseShape(body)) {
    throw new ApiResumeParseUnavailableError(
      "Resume parse API response shape was unexpected."
    );
  }
  return body;
}

function isApiResponseShape(value: unknown): value is ApiResumeParseResponse {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.extractedText === "string" &&
    typeof candidate.parseDiagnostic === "object" &&
    candidate.parseDiagnostic !== null
  );
}

/**
 * Read the contents of a `File` as a Base64 string. Used by the
 * upload handler to package the file for the JSON request.
 *
 * Wraps FileReader in a Promise. Lives in this module so the
 * upload code path stays clean and uses one consistent encoding.
 */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () =>
      reject(new Error("Could not read file from disk."));
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("File reader returned non-string result."));
        return;
      }
      // result is "data:<mime>;base64,<payload>" — strip the prefix.
      const commaIndex = result.indexOf(",");
      resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result);
    };
    reader.readAsDataURL(file);
  });
}
