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
