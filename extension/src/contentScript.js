/**
 * Agentic Job Ops content script.
 *
 * Runs in the user-authorized application page. Extracts a normalized,
 * value-redacted page structure and fills only fields the user has approved.
 *
 * Safety rules enforced here:
 * - Never read or send password fields, hidden credential fields, or cookies.
 * - Never include the actual values typed by the user, only `hasValue: boolean`.
 * - Never click submit. Submit happens only through the app, which requires
 *   explicit human approval and a persisted approval audit.
 * - Never bypass CAPTCHA, login challenges, or anti-bot systems. Mark them
 *   as sensitive so the app can pause for the user.
 *
 * The shared message contract is documented in extension/src/types.ts.
 */

const SENSITIVE_LABEL_TERMS = [
  "password",
  "ssn",
  "social security",
  "credit card",
  "cvv",
  "demographic",
  "gender",
  "race",
  "ethnicity",
  "veteran",
  "disability",
  "sexual orientation",
  "pronoun",
  "hispanic"
];

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function fieldTypeFor(input) {
  const tag = input.tagName.toLowerCase();
  if (tag === "textarea") return "textarea";
  if (tag === "select") return "select";
  const type = (input.getAttribute("type") || "text").toLowerCase();
  if (type === "email") return "email";
  if (type === "tel" || type === "phone") return "phone";
  if (type === "url") return "url";
  if (type === "file") return "file";
  if (type === "checkbox" || type === "radio") return "checkbox";
  return "text";
}

function labelFor(input) {
  const id = input.getAttribute("id");
  if (id) {
    const explicit = document.querySelector(`label[for="${CSS.escape(id)}"]`);
    if (explicit) {
      return normalizeText(explicit.textContent);
    }
  }
  const wrappingLabel = input.closest("label");
  if (wrappingLabel) {
    return normalizeText(wrappingLabel.textContent);
  }
  return (
    normalizeText(input.getAttribute("aria-label")) ||
    normalizeText(input.getAttribute("placeholder")) ||
    normalizeText(input.getAttribute("name")) ||
    normalizeText(input.getAttribute("id")) ||
    ""
  );
}

function isSensitive(label, type, name) {
  const lower = `${label} ${name || ""}`.toLowerCase();
  if (type === "password") return true;
  return SENSITIVE_LABEL_TERMS.some((term) => lower.includes(term));
}

function isCredentialOrHiddenField(input) {
  const type = (input.getAttribute("type") || "").toLowerCase();
  if (type === "password" || type === "hidden") return true;
  const autocomplete = (input.getAttribute("autocomplete") || "").toLowerCase();
  if (autocomplete.includes("password") || autocomplete.includes("current-password") || autocomplete.includes("new-password")) {
    return true;
  }
  return false;
}

function describeField(input, index) {
  const type = (input.getAttribute("type") || "").toLowerCase();
  const tag = input.tagName.toLowerCase();
  const name = input.getAttribute("name") || "";
  const id = input.getAttribute("id") || "";
  const label = labelFor(input);
  const fieldType = fieldTypeFor(input);
  const required =
    input.hasAttribute("required") ||
    input.getAttribute("aria-required") === "true";
  const sensitive = isSensitive(label, type, name);
  const value = "value" in input ? input.value : "";
  const hasValue = typeof value === "string" && value.trim().length > 0;
  const fieldId = id || name || `${tag}_${index + 1}`;
  return {
    fieldId,
    label: label || `Field ${index + 1}`,
    fieldType,
    inputName: name,
    inputId: id,
    placeholder: normalizeText(input.getAttribute("placeholder") || ""),
    required,
    sensitive,
    hasValue
  };
}

function detectCaptcha() {
  return Boolean(
    document.querySelector(".g-recaptcha, iframe[src*='recaptcha'], iframe[src*='hcaptcha'], [data-sitekey], [class*='captcha']")
  );
}

function detectLoginChallenge() {
  return Boolean(document.querySelector("input[type='password']"));
}

function detectSubmitButton() {
  return Boolean(
    document.querySelector(
      "button[type='submit'], input[type='submit'], button[name='commit']"
    )
  );
}

export function extractPageStructure() {
  const inputs = Array.from(
    document.querySelectorAll("input, textarea, select")
  );
  const fields = inputs
    .filter((input) => !isCredentialOrHiddenField(input))
    .map((input, index) => describeField(input, index));

  return {
    pageUrl: window.location.href,
    pageTitle: document.title || "",
    hostname: window.location.hostname,
    fields,
    hasSubmitButton: detectSubmitButton(),
    hasCaptcha: detectCaptcha(),
    hasLoginChallenge: detectLoginChallenge(),
    capturedAt: new Date().toISOString()
  };
}

function findInput(field) {
  if (field.inputId) {
    const byId = document.getElementById(field.inputId);
    if (byId) return byId;
  }
  if (field.inputName) {
    const byName = document.querySelector(
      `[name="${CSS.escape(field.inputName)}"]`
    );
    if (byName) return byName;
  }
  return null;
}

/**
 * Fill the supplied fields with the supplied previews.
 *
 * The extension never receives or stores actual personal values from the app —
 * the demo flow uses preview strings that demonstrate the architecture without
 * exposing private data. A production deployment would inject explicitly
 * approved values from a secure local source.
 */
export function applyFillPlan(fields) {
  const filled = [];
  for (const field of fields) {
    if (!field.fieldId) continue;
    const input = findInput(field);
    if (!input) continue;
    const tag = input.tagName.toLowerCase();
    const type = (input.getAttribute("type") || "").toLowerCase();
    if (type === "password" || type === "hidden" || type === "file") {
      // Never auto-fill credentials, hidden fields, or files from the
      // extension; uploads happen through the app's controlled flow.
      continue;
    }
    if (tag === "select") {
      // Skip selects unless an explicit option is provided; the demo
      // foundation does not auto-pick options for the user.
      continue;
    }
    const valueToWrite = field.value || field.valuePreview || "";
    if (!valueToWrite) continue;
    if ("value" in input) {
      input.value = valueToWrite;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }
    filled.push(field.fieldId);
  }
  return { filledFieldIds: filled };
}

if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || typeof message !== "object") {
      return undefined;
    }
    if (message.type === "agentic-job-ops/extract-page-structure") {
      sendResponse({ ok: true, structure: extractPageStructure() });
      return true;
    }
    if (message.type === "agentic-job-ops/apply-fill-plan") {
      sendResponse({ ok: true, ...applyFillPlan(message.fields || []) });
      return true;
    }
    return undefined;
  });
}
