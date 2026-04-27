/**
 * Server-side redaction helpers.
 *
 * The AI API server handles two classes of sensitive data:
 * 1. **Secrets** — API keys, bearer tokens, anything that would
 *    grant access to a third-party billed service.
 * 2. **User content** — raw resume text, application answers,
 *    PII embedded in prose.
 *
 * Both must stay out of stdout/stderr, audit logs, error messages,
 * and JSON responses. This module provides the only sanctioned way
 * to convert a request payload (or an error) into something safe
 * to log. Anything that bypasses these helpers is a potential
 * compliance bug.
 */

const KEY_PATTERN_HINTS = [
  "OPENAI_API_KEY",
  "AZURE_OPENAI_API_KEY",
  "API_KEY",
  "ACCESS_TOKEN",
  "BEARER",
  "AUTHORIZATION",
  "PASSWORD",
  "PASSPHRASE"
];

/**
 * Heuristic: does this string look like a secret that must never
 * appear in a log? Catches `sk-...` (OpenAI), long alnum tokens, and
 * Azure subscription keys.
 */
export function looksLikeSecret(value: string): boolean {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (trimmed.length < 16) return false;
  if (trimmed.startsWith("sk-")) return true;
  if (trimmed.startsWith("Bearer ")) return true;
  // Long base64-ish or hex-ish runs are almost always secrets in
  // this codebase's surface area.
  if (/^[A-Za-z0-9+/=_-]{32,}$/.test(trimmed)) return true;
  return false;
}

/**
 * Truncate a free-text payload to a small length for log lines.
 * Resume text and application answers can be very long and tend to
 * include PII — keep only enough to debug structural issues
 * (whitespace, encoding, missing fields).
 */
export function truncateForLog(value: string, maxChars = 64): string {
  const safe = String(value);
  if (safe.length <= maxChars) return safe;
  return `${safe.slice(0, maxChars)}…(${safe.length - maxChars} more chars)`;
}

/**
 * Recursively redact obvious secret-looking values inside an
 * arbitrary log payload. Strings on these blocked keys are
 * collapsed to `[redacted]` regardless of content. Strings that
 * just LOOK like secrets are also redacted.
 *
 * This is the only function that should be used to build a log
 * payload from a request body or response body.
 */
export function redactForLog(input: unknown, depth = 0): unknown {
  if (depth > 6) return "[redacted-depth]";
  if (input === null || input === undefined) return input;
  if (typeof input === "string") {
    return looksLikeSecret(input) ? "[redacted-secret]" : truncateForLog(input);
  }
  if (typeof input === "number" || typeof input === "boolean") {
    return input;
  }
  if (Array.isArray(input)) {
    return input.slice(0, 5).map((item) => redactForLog(item, depth + 1));
  }
  if (typeof input === "object") {
    const obj = input as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(obj)) {
      const upper = key.toUpperCase();
      if (KEY_PATTERN_HINTS.some((hint) => upper.includes(hint))) {
        out[key] = "[redacted-secret]";
        continue;
      }
      // Resume text / cover letter / application answers are
      // user-content fields that we never want to log at all.
      if (
        upper === "RESUMETEXT" ||
        upper === "RESUME_TEXT" ||
        upper === "COVERLETTER" ||
        upper === "ANSWER" ||
        upper === "ANSWERS"
      ) {
        const value = obj[key];
        if (typeof value === "string") {
          out[key] = `[redacted-user-content len=${value.length}]`;
          continue;
        }
        if (Array.isArray(value)) {
          out[key] = `[redacted-user-content count=${value.length}]`;
          continue;
        }
      }
      out[key] = redactForLog(obj[key], depth + 1);
    }
    return out;
  }
  return "[redacted-unknown]";
}

/**
 * Sanitise an Error for logging. Preserves the message and class
 * name (useful for triage) but strips any stringified payload that
 * may have been concatenated into the message.
 */
export function redactErrorForLog(error: unknown): {
  name: string;
  message: string;
} {
  if (error instanceof Error) {
    const message = redactSecretsInString(error.message);
    return { name: error.name, message };
  }
  return { name: "UnknownError", message: redactSecretsInString(String(error)) };
}

function redactSecretsInString(value: string): string {
  // Replace bearer tokens and `sk-...` strings inline so a stray
  // `throw new Error(\`OpenAI key ${apiKey} rejected\`)` can never
  // leak the key via logs.
  return value
    .replace(/Bearer\s+[A-Za-z0-9._\-+/=]{16,}/gi, "Bearer [redacted]")
    .replace(/sk-[A-Za-z0-9._\-+/=]{12,}/gi, "sk-[redacted]")
    .replace(/[A-Za-z0-9_-]{40,}/g, "[redacted-token]");
}
