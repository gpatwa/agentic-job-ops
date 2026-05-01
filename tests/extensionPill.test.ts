// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * The pill content script (extension/src/pill.js) is plain JavaScript
 * because Chrome doesn't run ES-module content scripts. We can't
 * `import` it directly from a TS test, so we read the source and
 * eval it inside jsdom with a test-mode flag that exposes the
 * internal helpers on `window.__agenticJobOpsPill`.
 *
 * We assert the structural safety properties first (no .click() on
 * submit, no .submit() on forms anywhere in the source), then drive
 * a synthetic Greenhouse-shape page through the fill engine to
 * confirm the React-aware setter dispatches input + change events.
 */

const PILL_SOURCE_PATH = resolve(
  process.cwd(),
  "extension",
  "src",
  "pill.js"
);
const PILL_SOURCE = readFileSync(PILL_SOURCE_PATH, "utf-8");

interface PillTestApi {
  buildSelectorGroups: (profile: Record<string, string>) => Array<{
    sel: string;
    value: string;
  }>;
  setReactValue: (el: HTMLElement, value: string) => void;
  tryFill: (selector: string, value: string) => boolean;
  fillCustomTextareas: (
    answers: Array<{ question: string; answer: string }>
  ) => number;
  normalizeLabel: (s: string) => string;
  findContinueButton: () => { element: HTMLElement; label: string } | null;
  looksLikeSubmitPage: () => boolean;
  mergeAnswerSources: (
    saved: Array<{ question?: string; answer?: string }>,
    payload: { activePackage?: { shortAnswersIncluded?: boolean }; activeAnswers?: Array<{ question: string; answer: string }> }
  ) => Array<{ question: string; answer: string }>;
}

declare global {
  interface Window {
    __agenticJobOpsPillTestMode?: boolean;
    __agenticJobOpsPill?: PillTestApi;
    __agenticJobOpsPillInjected?: boolean;
    chrome?: unknown;
  }
}

function loadPill(): PillTestApi {
  // Reset the IIFE guard between tests (the script otherwise refuses
  // to re-run after the first injection).
  delete window.__agenticJobOpsPillInjected;
  window.__agenticJobOpsPillTestMode = true;
  // Stub minimal chrome.* surface the script reads at module level.
  // In test mode the script never invokes them — but they're
  // referenced in handler bodies and the parser doesn't care.
  window.chrome = {
    storage: {
      local: { get: () => undefined, set: () => undefined }
    }
  } as unknown;
  // Use eval rather than dynamic import so the script's IIFE runs in
  // the jsdom window scope and exposes the test API on window.
  // eslint-disable-next-line no-eval
  eval(PILL_SOURCE);
  if (!window.__agenticJobOpsPill) {
    throw new Error("pill.js did not expose __agenticJobOpsPill in test mode");
  }
  return window.__agenticJobOpsPill;
}

/**
 * Strip JS comments so structural assertions don't false-positive
 * on prose that mentions `.submit()` in an explanatory comment.
 */
function withoutComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n");
}

describe("pill.js — structural safety properties", () => {
  it("never calls .submit() on a form (CLAUDE.md hard rule)", () => {
    // Hard rule from CLAUDE.md: the pill never auto-submits. The
    // safest enforcement is structural — the executable source must
    // contain no `.submit(` call. The pill DOES legitimately call
    // `.click()` on a Continue button in advance mode, but only
    // after a Continue/Next text match + a hard-stop check that
    // rejects pages with any Submit button visible.
    const stripped = withoutComments(PILL_SOURCE);
    expect(stripped).not.toMatch(/\.submit\s*\(/);
    // Submit detection happens by reading button TEXT, not by
    // clicking it. Confirm that helper exists.
    expect(PILL_SOURCE).toContain("looksLikeSubmitPage");
  });

  it("uses HTMLInputElement.prototype native setter for React-aware fill", () => {
    expect(PILL_SOURCE).toContain("HTMLInputElement.prototype");
    expect(PILL_SOURCE).toContain("HTMLTextAreaElement.prototype");
    expect(PILL_SOURCE).toContain('dispatchEvent(new Event("input"');
  });

  it("never sends saved-answer captures over the network", () => {
    // chrome.storage.local is the only persistence target; no fetch /
    // XMLHttpRequest / WebSocket / sendBeacon usage in pill.js.
    expect(PILL_SOURCE).not.toMatch(/\bfetch\s*\(/);
    expect(PILL_SOURCE).not.toMatch(/XMLHttpRequest/);
    expect(PILL_SOURCE).not.toMatch(/sendBeacon/);
  });
});

describe("pill.js — selector groups", () => {
  let api: PillTestApi;
  beforeEach(() => {
    api = loadPill();
  });

  it("splits fullName into first / last for Greenhouse field IDs", () => {
    const groups = api.buildSelectorGroups({
      fullName: "Gopal Patwa",
      email: "g@example.com",
      phone: "415-302-4337",
      location: "",
      linkedinUrl: "",
      githubUrl: "",
      portfolioUrl: ""
    });
    const firstNameGroup = groups.find((g) => g.sel.includes("#first_name"));
    const lastNameGroup = groups.find((g) => g.sel.includes("#last_name"));
    expect(firstNameGroup?.value).toBe("Gopal");
    expect(lastNameGroup?.value).toBe("Patwa");
  });

  it("returns empty values when profile lacks fullName", () => {
    const groups = api.buildSelectorGroups({
      fullName: "",
      email: "",
      phone: "",
      location: "",
      linkedinUrl: "",
      githubUrl: "",
      portfolioUrl: ""
    });
    expect(groups.find((g) => g.sel.includes("#first_name"))?.value).toBe("");
    expect(groups.find((g) => g.sel.includes("#email"))?.value).toBe("");
  });
});

describe("pill.js — fill engine", () => {
  let api: PillTestApi;
  beforeEach(() => {
    api = loadPill();
    document.body.innerHTML = "";
  });
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("React-aware setter triggers input + change events, not raw value assign", () => {
    const input = document.createElement("input");
    input.id = "first_name";
    document.body.appendChild(input);

    let inputCount = 0;
    let changeCount = 0;
    input.addEventListener("input", () => {
      inputCount += 1;
    });
    input.addEventListener("change", () => {
      changeCount += 1;
    });

    api.setReactValue(input, "Gopal");
    expect(input.value).toBe("Gopal");
    expect(inputCount).toBe(1);
    expect(changeCount).toBe(1);
  });

  it("tryFill matches a Greenhouse-style #first_name input", () => {
    document.body.innerHTML =
      '<input id="first_name" name="first_name" />' +
      '<input id="last_name" name="last_name" />';
    expect(api.tryFill("#first_name", "Gopal")).toBe(true);
    expect(
      (document.getElementById("first_name") as HTMLInputElement).value
    ).toBe("Gopal");
  });

  it("tryFill skips password / hidden / file inputs", () => {
    document.body.innerHTML =
      '<input id="pwd" type="password" />' +
      '<input id="hidden_csrf" type="hidden" />' +
      '<input id="file_upload" type="file" />';
    expect(api.tryFill("#pwd", "secret")).toBe(false);
    expect(api.tryFill("#hidden_csrf", "secret")).toBe(false);
    expect(api.tryFill("#file_upload", "/path")).toBe(false);
  });

  it("tryFill returns false when value is empty (no fake fill)", () => {
    document.body.innerHTML = '<input id="email" />';
    expect(api.tryFill("#email", "")).toBe(false);
  });

  it("fillCustomTextareas matches by associated label text", () => {
    document.body.innerHTML =
      '<label for="q1">Why are you interested in this role?</label>' +
      '<textarea id="q1"></textarea>';
    const filled = api.fillCustomTextareas([
      {
        question: "Why are you interested in this role?",
        answer: "Aligned with my data-platform leadership."
      }
    ]);
    expect(filled).toBe(1);
    expect((document.getElementById("q1") as HTMLTextAreaElement).value).toBe(
      "Aligned with my data-platform leadership."
    );
  });

  it("fillCustomTextareas skips textareas with no label", () => {
    document.body.innerHTML = '<textarea id="orphan"></textarea>';
    const filled = api.fillCustomTextareas([
      { question: "Why?", answer: "Because." }
    ]);
    expect(filled).toBe(0);
  });
});

describe("pill.js — fill-and-advance safety", () => {
  let api: PillTestApi;
  beforeEach(() => {
    api = loadPill();
    document.body.innerHTML = "";
  });
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("findContinueButton returns null when no continue / next text exists", () => {
    document.body.innerHTML = '<button>Some other action</button>';
    expect(api.findContinueButton()).toBeNull();
  });

  it("findContinueButton ignores buttons with type=submit even if labeled 'next'", () => {
    document.body.innerHTML =
      '<button type="submit">Next step</button>';
    expect(api.findContinueButton()).toBeNull();
  });

  it("findContinueButton ignores buttons labeled submit / send / apply", () => {
    document.body.innerHTML =
      '<button>Submit application</button>' +
      '<button>Send</button>' +
      '<button>Apply now</button>';
    expect(api.findContinueButton()).toBeNull();
  });

  it("looksLikeSubmitPage detects a visible Submit button", () => {
    document.body.innerHTML =
      '<button type="submit">Submit application</button>';
    // The element needs a non-zero rect for findContinueButton — but
    // looksLikeSubmitPage doesn't filter on rect, just on text.
    expect(api.looksLikeSubmitPage()).toBe(true);
  });

  it("looksLikeSubmitPage returns false on a Continue-only page", () => {
    document.body.innerHTML = '<button>Continue</button>';
    expect(api.looksLikeSubmitPage()).toBe(false);
  });
});

describe("pill.js — fillFormByLabelMatching on a Spring Health-shape form", () => {
  let api: PillTestApi & {
    buildFieldMatchers: (profile: Record<string, string>) => Array<{
      keywords: string[];
      value: string;
      kind?: string;
    }>;
    fillFormByLabelMatching: (
      matchers: Array<{ keywords: string[]; value: string; kind?: string }>
    ) => number;
  };
  beforeEach(() => {
    api = loadPill() as typeof api;
    document.body.innerHTML = "";
  });
  afterEach(() => {
    document.body.innerHTML = "";
  });

  function fullSpringHealthForm() {
    // Mirror the actual Spring Health Greenhouse application page
    // structure as closely as possible. Field types are accurate;
    // the surrounding layout classes are simplified.
    document.body.innerHTML = `
      <form>
        <div class="field">
          <label for="first_name">First Name *</label>
          <input id="first_name" name="first_name" type="text" />
        </div>
        <div class="field">
          <label for="last_name">Last Name *</label>
          <input id="last_name" name="last_name" type="text" />
        </div>
        <div class="field">
          <label for="email">Email *</label>
          <input id="email" name="email" type="email" />
        </div>
        <div class="field">
          <label for="phone">Phone *</label>
          <input id="phone" name="phone" type="tel" />
        </div>
        <div class="field">
          <label for="location">Location (City) *</label>
          <input id="location" name="job_application[location]" type="text" />
        </div>
        <div class="field">
          <label for="linkedin">LinkedIn Profile</label>
          <input id="linkedin" name="job_application[urls_attributes][0][value]" type="text" />
        </div>
        <div class="field">
          <label for="website">Website</label>
          <input id="website" name="job_application[urls_attributes][1][value]" type="text" />
        </div>
        <fieldset class="field">
          <legend>Will you require visa sponsorship now or in the future? *</legend>
          <label><input type="radio" name="visa" value="yes_now" /> Yes, I currently need a visa sponsorship.</label>
          <label><input type="radio" name="visa" value="yes_future" /> Yes, I may need a visa sponsorship in the future.</label>
          <label><input type="radio" name="visa" value="no" /> No, I do not and will not need a visa sponsorship.</label>
          <label><input type="radio" name="visa" value="unsure" /> I am unsure and will discuss in the interview.</label>
        </fieldset>
        <div class="field">
          <label for="eligible_us">Are you eligible to work in the U.S.? *</label>
          <select id="eligible_us" name="eligible_us">
            <option value="">Select...</option>
            <option>Yes</option>
            <option>No</option>
          </select>
        </div>
        <fieldset class="field">
          <legend>How did you hear about us? *</legend>
          <label><input type="checkbox" name="how_heard[]" value="LinkedIn" /> LinkedIn</label>
          <label><input type="checkbox" name="how_heard[]" value="Glassdoor" /> Glassdoor</label>
          <label><input type="checkbox" name="how_heard[]" value="Indeed" /> Indeed</label>
          <label><input type="checkbox" name="how_heard[]" value="Other" /> Other</label>
        </fieldset>
        <div class="field">
          <label for="confirm_email">Confirm your email address *</label>
          <input id="confirm_email" name="confirm_email" type="email" />
        </div>
        <div class="field">
          <label for="preferred_name">What is your preferred name?</label>
          <input id="preferred_name" name="preferred_name" type="text" />
        </div>
        <div class="field">
          <label for="city_state_zip">To help us determine appropriate compensation and benefits based on geographic location, please provide your city, state, and zip code. *</label>
          <textarea id="city_state_zip" name="city_state_zip"></textarea>
        </div>
        <div class="field">
          <label for="gender">Gender</label>
          <select id="gender" name="gender">
            <option value="">Select...</option>
            <option>Female</option>
            <option>Male</option>
            <option>Non-binary</option>
            <option>Prefer not to say</option>
          </select>
        </div>
        <div class="field">
          <label for="hispanic">Are you Hispanic/Latino?</label>
          <select id="hispanic" name="hispanic">
            <option value="">Select...</option>
            <option>Yes</option>
            <option>No</option>
            <option>Prefer not to say</option>
          </select>
        </div>
        <div class="field">
          <label for="veteran">Veteran Status</label>
          <select id="veteran" name="veteran">
            <option value="">Select...</option>
            <option>I am a protected veteran.</option>
            <option>I am not a protected veteran.</option>
            <option>I do not wish to answer.</option>
          </select>
        </div>
        <div class="field">
          <label for="disability">Disability Status</label>
          <select id="disability" name="disability">
            <option value="">Select...</option>
            <option>Yes, I have a disability, or have had one in the past.</option>
            <option>No, I do not have a disability and have not had one in the past.</option>
            <option>I do not want to answer.</option>
          </select>
        </div>
        <button type="submit">Submit application</button>
      </form>
    `;
  }

  function fullProfile() {
    return {
      fullName: "Gopal Patwa",
      email: "gopalpatwa@gmail.com",
      phone: "415-302-4337",
      location: "San Francisco Bay Area",
      linkedinUrl: "https://linkedin.com/in/gopalpatwa",
      githubUrl: "",
      portfolioUrl: "",
      workAuthorization: "Yes",
      visaSponsorshipNeeded:
        "No, I do not and will not need a visa sponsorship.",
      howDidYouHearAboutUs: "LinkedIn",
      genderIdentity: "Prefer not to say",
      raceEthnicity: "Prefer not to say",
      veteranStatus: "I am not a protected veteran.",
      disabilityStatus: "I do not want to answer."
    };
  }

  it("fills first name + last name + email + phone via #id labels", () => {
    fullSpringHealthForm();
    const matchers = api.buildFieldMatchers(fullProfile());
    const filled = api.fillFormByLabelMatching(matchers);
    expect(filled).toBeGreaterThanOrEqual(4);
    expect(
      (document.getElementById("first_name") as HTMLInputElement).value
    ).toBe("Gopal");
    expect(
      (document.getElementById("last_name") as HTMLInputElement).value
    ).toBe("Patwa");
    expect((document.getElementById("email") as HTMLInputElement).value).toBe(
      "gopalpatwa@gmail.com"
    );
    expect((document.getElementById("phone") as HTMLInputElement).value).toBe(
      "415-302-4337"
    );
  });

  it("fills LinkedIn even when name is the Greenhouse urls_attributes pattern", () => {
    fullSpringHealthForm();
    const matchers = api.buildFieldMatchers(fullProfile());
    api.fillFormByLabelMatching(matchers);
    expect(
      (document.getElementById("linkedin") as HTMLInputElement).value
    ).toBe("https://linkedin.com/in/gopalpatwa");
  });

  it("fills Location (City) and the city/state/zip textarea from profile.location", () => {
    fullSpringHealthForm();
    const matchers = api.buildFieldMatchers(fullProfile());
    api.fillFormByLabelMatching(matchers);
    expect(
      (document.getElementById("location") as HTMLInputElement).value
    ).toBe("San Francisco Bay Area");
    expect(
      (document.getElementById("city_state_zip") as HTMLTextAreaElement).value
    ).toBe("San Francisco Bay Area");
  });

  it("fills Confirm email using profile.email (not skipped because of the bare 'email' matcher)", () => {
    fullSpringHealthForm();
    const matchers = api.buildFieldMatchers(fullProfile());
    api.fillFormByLabelMatching(matchers);
    expect(
      (document.getElementById("confirm_email") as HTMLInputElement).value
    ).toBe("gopalpatwa@gmail.com");
  });

  it("fills Preferred name with the candidate's first name", () => {
    fullSpringHealthForm();
    const matchers = api.buildFieldMatchers(fullProfile());
    api.fillFormByLabelMatching(matchers);
    expect(
      (document.getElementById("preferred_name") as HTMLInputElement).value
    ).toBe("Gopal");
  });

  it("checks the visa-sponsorship radio matching the user's saved answer", () => {
    fullSpringHealthForm();
    const matchers = api.buildFieldMatchers(fullProfile());
    api.fillFormByLabelMatching(matchers);
    const radios = document.querySelectorAll(
      "input[name='visa']"
    ) as NodeListOf<HTMLInputElement>;
    const checked = Array.from(radios).find((r) => r.checked);
    expect(checked?.value).toBe("no");
  });

  it("checks the 'How did you hear about us?' checkbox whose label matches the user's saved value", () => {
    fullSpringHealthForm();
    const matchers = api.buildFieldMatchers(fullProfile());
    api.fillFormByLabelMatching(matchers);
    const checkboxes = document.querySelectorAll(
      "input[name='how_heard[]']"
    ) as NodeListOf<HTMLInputElement>;
    const checked = Array.from(checkboxes).filter((c) => c.checked);
    expect(checked).toHaveLength(1);
    expect(checked[0].value).toBe("LinkedIn");
  });

  it("picks the matching option in EEO selects (Gender / Veteran / Disability)", () => {
    fullSpringHealthForm();
    const matchers = api.buildFieldMatchers(fullProfile());
    api.fillFormByLabelMatching(matchers);
    expect(
      (document.getElementById("gender") as HTMLSelectElement).value
    ).toBe("Prefer not to say");
    expect(
      (document.getElementById("veteran") as HTMLSelectElement).value
    ).toBe("I am not a protected veteran.");
    expect(
      (document.getElementById("disability") as HTMLSelectElement).value
    ).toBe("I do not want to answer.");
  });

  it("fills the U.S. eligibility select from profile.workAuthorization", () => {
    fullSpringHealthForm();
    const matchers = api.buildFieldMatchers(fullProfile());
    api.fillFormByLabelMatching(matchers);
    expect(
      (document.getElementById("eligible_us") as HTMLSelectElement).value
    ).toBe("Yes");
  });

  it("never touches the type=submit button", () => {
    fullSpringHealthForm();
    const matchers = api.buildFieldMatchers(fullProfile());
    api.fillFormByLabelMatching(matchers);
    const submit = document.querySelector(
      "button[type='submit']"
    ) as HTMLButtonElement;
    // Submit button should not have agenticFilled marker; we never
    // even look at it because the querySelectorAll filter excludes
    // type=submit.
    expect(submit.dataset.agenticFilled).toBeUndefined();
  });

  it("on a re-fill, dataset.agenticFilled marker prevents double-fill", () => {
    fullSpringHealthForm();
    const matchers = api.buildFieldMatchers(fullProfile());
    const firstCount = api.fillFormByLabelMatching(matchers);
    expect(firstCount).toBeGreaterThanOrEqual(10);
    // Re-running the matcher should fill ZERO new fields (every
    // already-filled input is marked dataset.agenticFilled="1" and
    // skipped).
    const secondCount = api.fillFormByLabelMatching(matchers);
    expect(secondCount).toBe(0);
  });

  it("hits ≥12 fields on a full Spring Health-shape form (vs. the 4 the old engine hit)", () => {
    // Regression target: the user reported the OLD pill filled only
    // 4 of 16 detected fields on the real Spring Health page. The
    // new label-walker should fill at least 12 (every standard
    // contact + URL + visa radio + how-heard checkbox + EEO select
    // + confirm email + preferred name + city/state/zip).
    fullSpringHealthForm();
    const matchers = api.buildFieldMatchers(fullProfile());
    const filled = api.fillFormByLabelMatching(matchers);
    expect(filled).toBeGreaterThanOrEqual(12);
  });
});

describe("pill.js — saved-library answer merging", () => {
  let api: PillTestApi;
  beforeEach(() => {
    api = loadPill();
  });

  it("library-saved answers shadow per-job package answers on the same question", () => {
    const saved = [
      {
        question: "Why this role?",
        answer: "My library answer."
      }
    ];
    const payload = {
      activePackage: { shortAnswersIncluded: true },
      activeAnswers: [
        {
          question: "Why this role?",
          answer: "Per-job package draft."
        }
      ]
    };
    const merged = api.mergeAnswerSources(saved, payload);
    expect(merged).toHaveLength(1);
    expect(merged[0].answer).toBe("My library answer.");
  });

  it("falls through to per-job package answers when library has nothing", () => {
    const merged = api.mergeAnswerSources([], {
      activePackage: { shortAnswersIncluded: true },
      activeAnswers: [
        { question: "Tell us about yourself", answer: "Per-job draft." }
      ]
    });
    expect(merged).toHaveLength(1);
    expect(merged[0].answer).toBe("Per-job draft.");
  });

  it("returns no per-job answers when shortAnswersIncluded is false", () => {
    const merged = api.mergeAnswerSources([], {
      activePackage: { shortAnswersIncluded: false },
      activeAnswers: [{ question: "Q", answer: "A" }]
    });
    expect(merged).toHaveLength(0);
  });
});
