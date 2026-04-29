import type {
  ApplicationAnswer,
  ApplicationPackage,
  NormalizedJob,
  UserProfile
} from "../models/domain";

/**
 * Bookmarklet "Fill this form" generator.
 *
 * Replaces the copy-paste-each-field UX with a single drag-to-bookmarks-bar
 * action. Once installed, the candidate clicks the bookmarklet on the actual
 * Greenhouse / Lever application page and the form fills inline — no extension
 * install, no Web Store review, no auto-submit.
 *
 * Architecture (mirrors what Simplify.jobs / 1Password do, but as a self-
 * contained bookmarklet so we ship today):
 *
 *   1. We generate a `javascript:` URI with the user's profile values + ATS
 *      selector map BAKED IN. The data lives in the bookmarklet itself so
 *      there's no fetch / no CORS / no auth dance at click time.
 *   2. The script body finds each input by ATS-specific selector, sets the
 *      value via the React-aware native setter pattern (so React-controlled
 *      Greenhouse forms actually update their state, not just visually), and
 *      dispatches an `input` + `change` event.
 *   3. Filled fields get a 2px green outline + a floating banner reminds the
 *      user they still have to click Submit themselves.
 *   4. We deliberately DO NOT call `.click()` on any submit button. CLAUDE.md
 *      forbids auto-submit, the Simplify and MyGreenhouse defaults match this,
 *      and LazyApply's auto-click pattern is exactly the anti-pattern we
 *      avoid.
 *
 * Privacy + safety:
 *   - All data is inlined in the bookmarklet — never sent to any server,
 *     never logged. The bookmarklet contains the user's name + email + phone +
 *     EEO-1 answers, so the user must treat it like saved-credential data
 *     (don't share bookmarks bar). The UI surfaces this trade-off explicitly.
 *   - No CAPTCHA bypass. Custom-question textareas are filled with our drafts
 *     but the user reviews + edits before submit.
 *   - File inputs (resume upload) cannot be programmatically filled by JS —
 *     the user clicks "Choose file" themselves. We surface that as a
 *     post-fill instruction.
 */

export const FILL_BOOKMARKLET_VERSION = "fill-bookmarklet-v1";

/**
 * Per-field source data the bookmarklet uses to fill the form. Kept as a flat
 * shape so the generated JS stays compact (the whole script ends up in a URL).
 */
interface FillData {
  jobLabel: string;
  fields: {
    firstName: string;
    lastName: string;
    fullName: string;
    email: string;
    phone: string;
    location: string;
    linkedinUrl: string;
    githubUrl: string;
    portfolioUrl: string;
    workAuthorization: string;
    visaSponsorshipNeeded: string;
    howDidYouHearAboutUs: string;
    genderIdentity: string;
    raceEthnicity: string;
    veteranStatus: string;
    disabilityStatus: string;
  };
  resumeFileName: string | null;
  coverLetter: string | null;
  shortAnswers: Array<{ question: string; answer: string }>;
}

function firstNameOf(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  return parts[0] ?? "";
}

function lastNameOf(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  return parts.length > 1 ? parts.slice(1).join(" ") : "";
}

function buildFillData(input: {
  profile: UserProfile | null;
  applicationPackage: ApplicationPackage;
  answers: ApplicationAnswer[];
  job: NormalizedJob;
}): FillData {
  const profile = input.profile;
  const fullName = profile?.fullName ?? "";
  const visibleAnswers = input.applicationPackage.shortAnswersIncluded
    ? input.answers
        .filter((answer) => answer.answer.trim().length > 0)
        .map((answer) => ({ question: answer.question, answer: answer.answer }))
    : [];
  return {
    jobLabel: `${input.job.title} at ${input.job.company}`,
    fields: {
      firstName: firstNameOf(fullName),
      lastName: lastNameOf(fullName),
      fullName: fullName.trim(),
      email: profile?.email ?? "",
      phone: profile?.phone ?? "",
      location: profile?.location ?? "",
      linkedinUrl: profile?.linkedinUrl ?? "",
      githubUrl: profile?.githubUrl ?? "",
      portfolioUrl: profile?.portfolioUrl ?? "",
      workAuthorization: profile?.workAuthorization ?? "",
      visaSponsorshipNeeded: profile?.visaSponsorshipNeeded ?? "",
      howDidYouHearAboutUs: profile?.howDidYouHearAboutUs ?? "",
      genderIdentity: profile?.genderIdentity ?? "",
      raceEthnicity: profile?.raceEthnicity ?? "",
      veteranStatus: profile?.veteranStatus ?? "",
      disabilityStatus: profile?.disabilityStatus ?? ""
    },
    resumeFileName: null,
    coverLetter:
      input.applicationPackage.coverLetterIncluded &&
      input.applicationPackage.coverLetter.trim().length > 0
        ? input.applicationPackage.coverLetter
        : null,
    shortAnswers: visibleAnswers
  };
}

/**
 * The script body that runs when the user clicks the bookmarklet on the
 * actual application page. Self-contained — no globals, no external fetch.
 *
 * Exported separately so the test suite can exercise the field-mapping
 * logic without parsing `javascript:` URIs.
 */
export const FILL_SCRIPT_TEMPLATE = `
(function () {
  var data = __FILL_DATA__;

  // React-aware value setter. Setting input.value = "X" directly does NOT
  // trigger React's onChange — React tracks the previous value internally
  // and ignores the change. This pattern (used by Cypress, Testing Library,
  // and 1Password) calls the native setter then dispatches an input event so
  // React's synthetic event system picks it up.
  function setReactValue(el, value) {
    var prototype = el.tagName === "TEXTAREA"
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
    var setter = Object.getOwnPropertyDescriptor(prototype, "value").set;
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function highlight(el) {
    el.style.outline = "2px solid #047857";
    el.style.outlineOffset = "1px";
  }

  function tryFill(selector, value) {
    if (!value) return false;
    var el = document.querySelector(selector);
    if (!el) return false;
    if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
      setReactValue(el, value);
      highlight(el);
      return true;
    }
    if (el.tagName === "SELECT") {
      // Match by option text OR value
      var options = el.options;
      for (var i = 0; i < options.length; i++) {
        if (options[i].text === value || options[i].value === value) {
          el.selectedIndex = i;
          el.dispatchEvent(new Event("change", { bubbles: true }));
          highlight(el);
          return true;
        }
      }
    }
    return false;
  }

  var filledCount = 0;

  // Greenhouse-hosted boards use stable field IDs we can target directly.
  // Lever forms use input[name="..."]. Generic forms get a best-effort pass
  // via input[autocomplete="..."] (HTML5 standard).
  var selectorGroups = [
    // Greenhouse standard
    { sel: "#first_name, input[name='first_name'], input[autocomplete='given-name']", value: data.fields.firstName },
    { sel: "#last_name, input[name='last_name'], input[autocomplete='family-name']", value: data.fields.lastName },
    { sel: "input[name='name'], input[autocomplete='name']", value: data.fields.fullName },
    { sel: "#email, input[name='email'], input[type='email'], input[autocomplete='email']", value: data.fields.email },
    { sel: "#phone, input[name='phone'], input[type='tel'], input[autocomplete='tel']", value: data.fields.phone },
    { sel: "input[name='location'], input[autocomplete='address-level2']", value: data.fields.location },
    { sel: "input[name='urls[LinkedIn]'], input[name='linkedin'], input[name*='linkedin' i]", value: data.fields.linkedinUrl },
    { sel: "input[name='urls[GitHub]'], input[name='github'], input[name*='github' i]", value: data.fields.githubUrl },
    { sel: "input[name='urls[Portfolio]'], input[name='website'], input[name*='portfolio' i], input[name*='website' i]", value: data.fields.portfolioUrl }
  ];

  for (var i = 0; i < selectorGroups.length; i++) {
    if (tryFill(selectorGroups[i].sel, selectorGroups[i].value)) {
      filledCount++;
    }
  }

  // Custom Greenhouse questions: <textarea name="job_application[answers_attributes][N][text_value]">.
  // We can't predict N; instead we walk every textarea and try to match the
  // question text (in a sibling label) against our saved short-answer
  // questions.
  if (data.shortAnswers.length > 0) {
    var textareas = document.querySelectorAll("textarea");
    for (var t = 0; t < textareas.length; t++) {
      var ta = textareas[t];
      var labelText = "";
      // Look for an associated label (id-for or wrapping)
      if (ta.id) {
        var lbl = document.querySelector("label[for='" + ta.id + "']");
        if (lbl) labelText = lbl.textContent || "";
      }
      if (!labelText && ta.closest("label")) {
        labelText = ta.closest("label").textContent || "";
      }
      if (!labelText) {
        var parent = ta.closest(".field, .input-field, .form-field, .input, fieldset");
        if (parent) {
          var lbl2 = parent.querySelector("label");
          if (lbl2) labelText = lbl2.textContent || "";
        }
      }
      var normalized = labelText.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      for (var s = 0; s < data.shortAnswers.length; s++) {
        var qa = data.shortAnswers[s];
        var qNorm = qa.question.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
        if (normalized && (normalized.indexOf(qNorm) !== -1 || qNorm.indexOf(normalized) !== -1)) {
          setReactValue(ta, qa.answer);
          highlight(ta);
          filledCount++;
          break;
        }
      }
    }
  }

  // Floating confirmation banner. Stays on screen for 12s; the user knows the
  // fill ran and that they still have to review + click Submit themselves.
  var banner = document.createElement("div");
  banner.style.cssText =
    "position:fixed;top:16px;right:16px;z-index:2147483647;" +
    "background:#047857;color:white;padding:14px 18px;border-radius:8px;" +
    "font:14px/1.5 system-ui,sans-serif;box-shadow:0 8px 32px rgba(0,0,0,0.18);" +
    "max-width:340px";
  banner.innerHTML =
    "<div style='font-weight:600;margin-bottom:4px'>" +
    "Filled " + filledCount + " field" + (filledCount === 1 ? "" : "s") +
    " for: " + (data.jobLabel.replace(/</g, "&lt;")) +
    "</div>" +
    "<div style='font-size:12px;opacity:0.9'>" +
    "Review every field, attach your resume manually, then click the form's Submit yourself. " +
    "We never auto-submit." +
    "</div>";
  document.body.appendChild(banner);
  setTimeout(function () { banner.remove(); }, 12000);
})();
`.trim();

export interface GenerateFillBookmarkletInput {
  profile: UserProfile | null;
  applicationPackage: ApplicationPackage;
  answers: ApplicationAnswer[];
  job: NormalizedJob;
}

/**
 * Build the `javascript:` URI the user drags to their bookmarks bar.
 * The data is JSON-stringified, then the whole script is URI-encoded so it
 * survives copy-paste through every browser's bookmark editor.
 */
export function generateFillBookmarklet(
  input: GenerateFillBookmarkletInput
): string {
  const data = buildFillData(input);
  const dataLiteral = JSON.stringify(data);
  const script = FILL_SCRIPT_TEMPLATE.replace("__FILL_DATA__", dataLiteral);
  // Wrap in `javascript:` URI; the browser bookmark engine handles
  // URL-encoding internally, but we encode whitespace + a few special chars
  // ourselves so the resulting string copy-pastes safely.
  return "javascript:" + encodeURIComponent(script);
}

/**
 * Approximate count of fields the bookmarklet WILL try to fill given the
 * current profile + package. Surfaced in the UI as "Will fill ~N fields"
 * so the user knows what to expect before they click. Pure function — no
 * DOM access; we just count the data slots that have non-empty values.
 */
export function countFillableSlots(
  input: GenerateFillBookmarkletInput
): number {
  const data = buildFillData(input);
  let count = 0;
  for (const value of Object.values(data.fields)) {
    if (value && value.trim().length > 0) count++;
  }
  count += data.shortAnswers.length;
  return count;
}
