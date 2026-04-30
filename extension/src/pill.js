/**
 * Apply-with-Agentic pill content script.
 *
 * Auto-injected by the manifest on Greenhouse + Lever application
 * pages. Renders a floating "Apply with Agentic" pill bottom-right;
 * click → reads the synced profile from chrome.storage and fills
 * every detected input inline.
 *
 * Why we mirror Simplify.jobs / 1Password here:
 *   - Onboarding is "click install, click pill, done". No bookmarks
 *     bar drag, no JS pasted into a URL bar. This is the UX the user
 *     specifically asked for after the bookmarklet revamp.
 *   - Profile data lives in chrome.storage.local, populated by the
 *     dashboardBridge content script when the user has the dashboard
 *     open in another tab. Sync is automatic; the pill just consumes.
 *   - Field mapping uses stable Greenhouse field IDs (#first_name,
 *     #last_name, etc.) + Lever name= attributes + HTML5 autocomplete
 *     fallback. Custom textarea questions match by associated label.
 *
 * Hard rules (mirrors CLAUDE.md):
 *   - NEVER click submit. The script has no .click() / .submit() call
 *     anywhere; tests assert this. The candidate reviews and clicks
 *     Submit themselves.
 *   - NEVER bypass CAPTCHA. Captcha-bearing pages still get the pill,
 *     but the floating banner explicitly tells the user to solve it
 *     manually after fill.
 *   - NEVER fill password / hidden / file inputs. Resume upload is a
 *     manual click — the pill banner reminds you which file to attach.
 */

(function () {
  // Bail if we've already injected (some ATSs hot-reload the content
  // and re-inject the script multiple times).
  if (window.__agenticJobOpsPillInjected) return;
  window.__agenticJobOpsPillInjected = true;

  const STORAGE_KEY = "agentic-job-ops/sync-v1";
  const SAVED_ANSWERS_KEY = "agentic-job-ops/saved-answers-v1";
  const PILL_ID = "agentic-job-ops-pill";
  const BANNER_ID = "agentic-job-ops-banner";
  const FILL_ADVANCE_BANNER_ID = "agentic-job-ops-advance";
  const SAVE_BUTTON_CLASS = "agentic-save-answer-chip";

  // Tracks which textareas the user has typed into AFTER our fill so
  // we know which questions to offer save-to-library on.
  const userTypedQuestions = new Map(); // labelText → { textarea, answerSoFar }
  let advanceMode = false;
  let advanceCountdownId = null;

  /** ------------------------------------------------------------------
   * Field mapping. Stable selectors first (Greenhouse / Lever ID +
   * name= patterns), then HTML5 autocomplete attribute, then a
   * label-based fallback for custom textareas. Keep the list short —
   * over-aggressive matching causes wrong-field fills which are worse
   * than missing fields.
   * ------------------------------------------------------------------ */
  function buildSelectorGroups(profile) {
    const fullName = (profile.fullName || "").trim();
    const parts = fullName.split(/\s+/).filter(Boolean);
    const firstName = parts[0] || "";
    const lastName = parts.length > 1 ? parts.slice(1).join(" ") : "";

    return [
      {
        sel:
          "#first_name, input[name='first_name'], input[autocomplete='given-name']",
        value: firstName
      },
      {
        sel:
          "#last_name, input[name='last_name'], input[autocomplete='family-name']",
        value: lastName
      },
      {
        sel: "input[name='name'], input[autocomplete='name']",
        value: fullName
      },
      {
        sel:
          "#email, input[name='email'], input[type='email'], input[autocomplete='email']",
        value: profile.email || ""
      },
      {
        sel:
          "#phone, input[name='phone'], input[type='tel'], input[autocomplete='tel']",
        value: profile.phone || ""
      },
      {
        sel:
          "input[name='location'], input[autocomplete='address-level2'], input[name*='location' i]",
        value: profile.location || ""
      },
      {
        sel:
          "input[name='urls[LinkedIn]'], input[name='linkedin'], input[name*='linkedin' i]",
        value: profile.linkedinUrl || ""
      },
      {
        sel: "input[name='urls[GitHub]'], input[name='github'], input[name*='github' i]",
        value: profile.githubUrl || ""
      },
      {
        sel:
          "input[name='urls[Portfolio]'], input[name='website'], input[name*='portfolio' i], input[name*='website' i]",
        value: profile.portfolioUrl || ""
      }
    ];
  }

  /**
   * React-aware value setter. Setting input.value = "X" directly does
   * NOT trigger React's onChange — React tracks the previous value
   * internally and the change is ignored. This pattern (used by
   * Cypress, Testing Library, 1Password) calls the native HTMLElement
   * prototype setter then dispatches an input event so React's
   * synthetic event system picks it up.
   */
  function setReactValue(el, value) {
    const prototype =
      el.tagName === "TEXTAREA"
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value").set;
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
    const el = document.querySelector(selector);
    if (!el) return false;
    if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
      // NEVER touch password / hidden / file inputs.
      const type = (el.getAttribute("type") || "").toLowerCase();
      if (type === "password" || type === "hidden" || type === "file") return false;
      setReactValue(el, value);
      highlight(el);
      return true;
    }
    if (el.tagName === "SELECT") {
      const options = el.options;
      for (let i = 0; i < options.length; i += 1) {
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

  /** ------------------------------------------------------------------
   * Custom-question textarea matching. Walks every <textarea>, finds
   * its associated label (via for=, closest label, or sibling field
   * label class), normalizes the label text, and matches against
   * saved short-answer questions.
   * ------------------------------------------------------------------ */
  function findTextareaLabel(textarea) {
    if (textarea.id) {
      const lbl = document.querySelector("label[for='" + textarea.id + "']");
      if (lbl) return lbl.textContent || "";
    }
    if (textarea.closest("label")) {
      return textarea.closest("label").textContent || "";
    }
    const parent = textarea.closest(
      ".field, .input-field, .form-field, .input, fieldset"
    );
    if (parent) {
      const lbl = parent.querySelector("label");
      if (lbl) return lbl.textContent || "";
    }
    return "";
  }

  function normalizeLabel(s) {
    return String(s || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  function fillCustomTextareas(answers) {
    if (!Array.isArray(answers) || answers.length === 0) return 0;
    let filled = 0;
    const textareas = document.querySelectorAll("textarea");
    textareas.forEach((ta) => {
      const labelText = findTextareaLabel(ta);
      if (!labelText) return;
      const normalized = normalizeLabel(labelText);
      for (const qa of answers) {
        const qNorm = normalizeLabel(qa.question);
        if (
          normalized &&
          qNorm &&
          (normalized.indexOf(qNorm) !== -1 || qNorm.indexOf(normalized) !== -1)
        ) {
          setReactValue(ta, qa.answer);
          highlight(ta);
          filled += 1;
          break;
        }
      }
    });
    return filled;
  }

  /** ------------------------------------------------------------------
   * Floating UI. Two stacked controls bottom-right:
   *   - Primary "Apply with Agentic" pill: fill the visible page once
   *   - Secondary "Fill & advance" toggle: enables Manus-style click-
   *     to-takeover so the agent walks multi-page Greenhouse flows.
   * After fill, a transient banner shows the count + reminders.
   * ------------------------------------------------------------------ */
  function makePill() {
    const wrapper = document.createElement("div");
    wrapper.id = PILL_ID;
    wrapper.style.cssText = [
      "position:fixed",
      "bottom:24px",
      "right:24px",
      "z-index:2147483646",
      "display:flex",
      "flex-direction:column",
      "align-items:flex-end",
      "gap:8px",
      "font:14px/1.3 system-ui,sans-serif"
    ].join(";");

    const pill = document.createElement("button");
    pill.type = "button";
    pill.textContent = "Apply with Agentic";
    pill.style.cssText = [
      "background:#047857",
      "color:white",
      "padding:12px 20px",
      "border:none",
      "border-radius:24px",
      "font:600 14px/1 system-ui,sans-serif",
      "cursor:pointer",
      "box-shadow:0 8px 32px rgba(4,120,87,0.35)",
      "transition:transform 0.12s ease,box-shadow 0.12s ease"
    ].join(";");
    pill.addEventListener("mouseenter", () => {
      pill.style.transform = "translateY(-1px)";
      pill.style.boxShadow = "0 12px 36px rgba(4,120,87,0.45)";
    });
    pill.addEventListener("mouseleave", () => {
      pill.style.transform = "";
      pill.style.boxShadow = "0 8px 32px rgba(4,120,87,0.35)";
    });
    pill.addEventListener("click", () => handlePillClick({ advance: advanceMode }));
    wrapper.appendChild(pill);

    // Fill & advance toggle. Off by default; turning it on opts the
    // user into "click Continue between pages automatically with a
    // 5s cancel countdown." We never auto-click Submit — see
    // findContinueButton's hard-stop logic.
    const toggleRow = document.createElement("label");
    toggleRow.style.cssText = [
      "background:rgba(15,23,42,0.85)",
      "color:white",
      "padding:6px 10px",
      "border-radius:14px",
      "font:500 11px/1.2 system-ui,sans-serif",
      "cursor:pointer",
      "display:flex",
      "align-items:center",
      "gap:6px",
      "user-select:none"
    ].join(";");
    const toggle = document.createElement("input");
    toggle.type = "checkbox";
    toggle.checked = advanceMode;
    toggle.style.cssText = "margin:0;cursor:pointer";
    toggle.addEventListener("change", () => {
      advanceMode = toggle.checked;
    });
    toggleRow.appendChild(toggle);
    toggleRow.appendChild(
      document.createTextNode("Fill & advance multi-page")
    );
    wrapper.appendChild(toggleRow);

    return wrapper;
  }

  function showBanner(message, tone) {
    const existing = document.getElementById(BANNER_ID);
    if (existing) existing.remove();
    const banner = document.createElement("div");
    banner.id = BANNER_ID;
    banner.style.cssText = [
      "position:fixed",
      "top:24px",
      "right:24px",
      "z-index:2147483647",
      tone === "error"
        ? "background:#b91c1c"
        : tone === "warn"
          ? "background:#b45309"
          : "background:#047857",
      "color:white",
      "padding:14px 18px",
      "border-radius:8px",
      "font:14px/1.5 system-ui,sans-serif",
      "box-shadow:0 8px 32px rgba(0,0,0,0.18)",
      "max-width:340px"
    ].join(";");
    banner.innerHTML = message;
    document.body.appendChild(banner);
    setTimeout(() => banner.remove(), 12000);
  }

  /** ------------------------------------------------------------------
   * Click handler. Reads sync payload from chrome.storage; if the
   * payload is empty (user hasn't visited the dashboard yet) shows a
   * helpful banner pointing at the dashboard URL. Otherwise fills the
   * form using the selector groups + custom-question matcher, and
   * then either:
   *   - shows the success banner (default), OR
   *   - schedules a 5-sec auto-advance to click the Continue/Next
   *     button (when `advanceMode` is true).
   *
   * After fill, we ALSO walk unmapped textareas / inputs and attach
   * a "Save to library" chip so the user can teach us answers we
   * didn't know — Simplify's killer pattern.
   * ------------------------------------------------------------------ */
  function handlePillClick(options) {
    const advance = options && options.advance;
    chrome.storage.local.get(
      [STORAGE_KEY, SAVED_ANSWERS_KEY],
      (result) => {
        const payload = result && result[STORAGE_KEY];
        const savedAnswers = (result && result[SAVED_ANSWERS_KEY]) || [];
        if (!payload || !payload.profile) {
          showBanner(
            "<div style='font-weight:600;margin-bottom:4px'>No profile synced yet</div>" +
              "<div style='font-size:12px;opacity:0.95'>" +
              "Open your <a href='http://localhost:5173/' target='_blank' style='color:white;text-decoration:underline'>Agentic dashboard</a>" +
              ", click <strong>Sync to extension</strong> on the Browser Assistant page, then come back here.</div>",
            "warn"
          );
          return;
        }
        const profile = payload.profile;
        const groups = buildSelectorGroups(profile);
        let filledCount = 0;
        groups.forEach((g) => {
          if (tryFill(g.sel, g.value)) filledCount += 1;
        });

        // Fill standard application-defaults / EEO selects too.
        filledCount += fillSelects(profile);

        // Custom-question textareas — first try the saved-answer
        // library (cross-application reuse), then the active package's
        // short answers (this-job-specific drafts). Library hits
        // shadow per-job drafts because the user explicitly saved
        // them as the canonical answer.
        const allAnswers = mergeAnswerSources(savedAnswers, payload);
        if (allAnswers.length > 0) {
          filledCount += fillCustomTextareas(allAnswers);
        }

        // Attach "Save to library" chips on textareas the user types
        // into so unmapped questions can be captured for next time.
        attachSaveAnswerChips();

        const jobLabel =
          (payload.activeJob &&
            payload.activeJob.title &&
            payload.activeJob.company &&
            payload.activeJob.title + " at " + payload.activeJob.company) ||
          "this application";

        if (advance) {
          startAdvanceCountdown(filledCount, jobLabel);
          return;
        }

        showBanner(
          "<div style='font-weight:600;margin-bottom:4px'>" +
            "Filled " +
            filledCount +
            " field" +
            (filledCount === 1 ? "" : "s") +
            " for: " +
            escapeHtml(jobLabel) +
            "</div>" +
            "<div style='font-size:12px;opacity:0.95'>" +
            "Review every field, attach your resume manually, then click the form's Submit yourself. " +
            "We never auto-submit." +
            "</div>",
          "success"
        );
      }
    );
  }

  /**
   * Combine saved-library answers (cross-application) with active
   * package short answers (this-job-specific). Library entries win on
   * tie because the user explicitly set them as their canonical
   * answer.
   */
  function mergeAnswerSources(savedAnswers, payload) {
    const out = [];
    const seen = new Set();
    for (const entry of savedAnswers) {
      if (!entry || !entry.question || !entry.answer) continue;
      out.push({ question: entry.question, answer: entry.answer });
      seen.add(normalizeLabel(entry.question));
    }
    const pkg = payload.activePackage || {};
    if (pkg.shortAnswersIncluded && Array.isArray(payload.activeAnswers)) {
      for (const a of payload.activeAnswers) {
        if (!a || !a.question || !a.answer) continue;
        const key = normalizeLabel(a.question);
        if (seen.has(key)) continue;
        out.push({ question: a.question, answer: a.answer });
      }
    }
    return out;
  }

  /** ------------------------------------------------------------------
   * "Save this answer once" capture. After fill, we walk every
   * textarea and unmapped text input. For each one with a derivable
   * label that's not already in our saved library, attach a small
   * floating chip "Save to Agentic library" positioned next to the
   * input. Click → captures the current value, stores in
   * chrome.storage.local under the saved-answers key, and updates
   * the chip to "Saved ✓".
   *
   * On the dashboard's next page visit, the dashboardBridge content
   * script reads the saved-answers key and posts it back to the
   * dashboard, which merges into savedAnswerLibrary.upsertSavedAnswer.
   * ------------------------------------------------------------------ */
  function attachSaveAnswerChips() {
    const candidates = document.querySelectorAll(
      "textarea, input[type='text']:not([id='first_name']):not([id='last_name']):not([id='email']):not([id='phone'])"
    );
    candidates.forEach((field) => {
      // Don't double-attach.
      if (field.dataset.agenticSaveChipAttached === "1") return;
      const label = findTextareaLabel(field);
      if (!label || label.length < 8 || label.length > 240) return;
      // Skip if this looks like a standard contact field we already
      // know how to fill.
      const labelNorm = normalizeLabel(label);
      if (
        /first name|last name|full name|email|phone|location|linkedin|github|portfolio|website/i.test(
          labelNorm
        )
      ) {
        return;
      }
      field.dataset.agenticSaveChipAttached = "1";

      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = SAVE_BUTTON_CLASS;
      chip.textContent = "Save to Agentic library";
      chip.style.cssText = [
        "display:none",
        "margin-top:6px",
        "background:#0f172a",
        "color:white",
        "border:none",
        "padding:6px 10px",
        "border-radius:14px",
        "font:500 11px/1.2 system-ui,sans-serif",
        "cursor:pointer",
        "box-shadow:0 4px 12px rgba(15,23,42,0.18)"
      ].join(";");
      chip.addEventListener("click", (event) => {
        event.preventDefault();
        const answer = (field.value || "").trim();
        if (answer.length < 4) {
          chip.textContent = "Type an answer first";
          setTimeout(() => {
            chip.textContent = "Save to Agentic library";
          }, 2000);
          return;
        }
        captureSavedAnswer({ question: label, answer });
        chip.textContent = "Saved ✓ — auto-fill next time";
        chip.disabled = true;
        chip.style.opacity = "0.7";
        chip.style.cursor = "default";
      });

      // Show the chip when the field has any user content.
      const reveal = () => {
        const value = (field.value || "").trim();
        chip.style.display = value.length >= 4 ? "inline-block" : "none";
      };
      field.addEventListener("input", reveal);
      field.addEventListener("blur", reveal);

      // Insert the chip after the field. Best-effort positioning;
      // some ATS layouts have wrapping divs that absorb it cleanly,
      // others render it just below the input — both are acceptable.
      if (field.parentElement) {
        field.parentElement.insertBefore(chip, field.nextSibling);
      }
      reveal();
    });
  }

  function captureSavedAnswer(entry) {
    chrome.storage.local.get([SAVED_ANSWERS_KEY], (result) => {
      const existing = (result && result[SAVED_ANSWERS_KEY]) || [];
      const normalized = normalizeLabel(entry.question);
      const filtered = existing.filter(
        (e) => normalizeLabel(e.question) !== normalized
      );
      filtered.unshift({
        question: entry.question,
        answer: entry.answer,
        capturedAt: new Date().toISOString(),
        capturedFromUrl: window.location.href
      });
      // Cap the local cache at 100 entries to bound storage. The
      // canonical store is the savedAnswerLibrary on the dashboard;
      // chrome.storage is just the buffer until the next sync.
      const trimmed = filtered.slice(0, 100);
      chrome.storage.local.set({ [SAVED_ANSWERS_KEY]: trimmed });
    });
  }

  /** ------------------------------------------------------------------
   * Fill & advance — Manus-pattern click-to-takeover.
   *
   * After fill, finds a Continue / Next button on the page (NEVER a
   * Submit button). Shows a 5-second countdown banner with a Cancel
   * button. On countdown end: clicks Continue, waits for the next
   * page to settle, re-fills, repeats. ANY user click anywhere on
   * the document during the countdown cancels the auto-advance —
   * the "click to take over" behavior Manus made famous.
   *
   * Hard-stop conditions:
   *   - Page has a Submit button visible. We never auto-click submit.
   *   - No Continue button found. The user has to drive the rest.
   *   - User clicks anything during the countdown.
   *   - User toggles the "Fill & advance" pill off (next click is
   *     a manual fill).
   * ------------------------------------------------------------------ */
  function startAdvanceCountdown(filledCount, jobLabel) {
    cancelAdvanceCountdown();
    const next = findContinueButton();
    if (!next) {
      showBanner(
        "<div style='font-weight:600;margin-bottom:4px'>" +
          "Filled " +
          filledCount +
          " field" +
          (filledCount === 1 ? "" : "s") +
          ". No Continue button found.</div>" +
          "<div style='font-size:12px;opacity:0.95'>" +
          "Review the page and click whatever button advances to the next step yourself. " +
          "We never auto-submit.</div>",
        "success"
      );
      return;
    }
    // Detect a Submit button anywhere on the page — if present,
    // refuse to auto-advance. Submit always requires explicit human
    // approval per CLAUDE.md.
    if (looksLikeSubmitPage()) {
      showBanner(
        "<div style='font-weight:600;margin-bottom:4px'>" +
          "Filled " +
          filledCount +
          " field" +
          (filledCount === 1 ? "" : "s") +
          " — final review</div>" +
          "<div style='font-size:12px;opacity:0.95'>" +
          "This page has a Submit button. Auto-advance stops here. " +
          "Review every field and click Submit yourself.</div>",
        "warn"
      );
      return;
    }

    const banner = document.createElement("div");
    banner.id = FILL_ADVANCE_BANNER_ID;
    banner.style.cssText = [
      "position:fixed",
      "top:24px",
      "right:24px",
      "z-index:2147483647",
      "background:#0f172a",
      "color:white",
      "padding:14px 18px",
      "border-radius:8px",
      "font:14px/1.5 system-ui,sans-serif",
      "box-shadow:0 8px 32px rgba(0,0,0,0.18)",
      "max-width:360px",
      "display:flex",
      "flex-direction:column",
      "gap:8px"
    ].join(";");
    document.body.appendChild(banner);

    let remaining = 5;
    const update = () => {
      banner.innerHTML =
        "<div style='font-weight:600'>" +
        "Filled " +
        filledCount +
        " field" +
        (filledCount === 1 ? "" : "s") +
        " for " +
        escapeHtml(jobLabel) +
        ".</div>" +
        "<div style='font-size:12px;opacity:0.9'>" +
        "Will click <strong>" +
        escapeHtml(next.label) +
        "</strong> in <strong>" +
        remaining +
        "s</strong>. Click anywhere on the page to cancel and review.</div>" +
        "<div><button id='agentic-cancel-advance' " +
        "style='background:#b45309;color:white;border:none;padding:6px 10px;" +
        "border-radius:6px;font:600 11px system-ui,sans-serif;cursor:pointer'>" +
        "Cancel auto-advance</button></div>";
      const cancelBtn = banner.querySelector("#agentic-cancel-advance");
      if (cancelBtn) {
        cancelBtn.addEventListener("click", (event) => {
          event.stopPropagation();
          cancelAdvanceCountdown();
          banner.remove();
        });
      }
    };
    update();

    const onUserClick = (event) => {
      // Ignore clicks ON our own banner (Cancel button is handled
      // above). Any other click cancels the countdown.
      if (banner.contains(event.target)) return;
      cancelAdvanceCountdown();
      banner.remove();
    };
    document.addEventListener("click", onUserClick, true);

    advanceCountdownId = setInterval(() => {
      remaining -= 1;
      if (remaining > 0) {
        update();
        return;
      }
      cancelAdvanceCountdown();
      document.removeEventListener("click", onUserClick, true);
      banner.remove();
      // Final safety check before clicking — page might have re-
      // rendered since we made the decision.
      if (looksLikeSubmitPage()) {
        showBanner(
          "<div style='font-weight:600'>Stopped before submit.</div>" +
            "<div style='font-size:12px;opacity:0.95'>This page now looks like the final review screen. Click Submit yourself.</div>",
          "warn"
        );
        return;
      }
      next.element.click();
      // Re-fill on the next page after a small delay for the new
      // form to render. We don't loop forever — only one re-fill
      // per countdown so the user can intervene each step.
      setTimeout(() => {
        handlePillClick({ advance: advanceMode });
      }, 800);
    }, 1000);
  }

  function cancelAdvanceCountdown() {
    if (advanceCountdownId) {
      clearInterval(advanceCountdownId);
      advanceCountdownId = null;
    }
    const existing = document.getElementById(FILL_ADVANCE_BANNER_ID);
    if (existing) existing.remove();
  }

  /**
   * Find a button that advances to the next step but is NOT a
   * submit. We score candidates by visible text (continue / next /
   * proceed) and reject any button labeled submit/apply/send. Only
   * `<button type="button">`, `<button>` (no type), and `<a>` are
   * considered — `<button type="submit">` is excluded categorically.
   */
  function findContinueButton() {
    const candidates = Array.from(
      document.querySelectorAll(
        "button:not([type='submit']), a[role='button'], a.button"
      )
    );
    for (const el of candidates) {
      const text = (el.textContent || "").trim().toLowerCase();
      if (!text) continue;
      if (/submit|send application|apply now|send/.test(text)) continue;
      if (/continue|next|proceed|save and continue|next step/.test(text)) {
        // Exclude hidden / disabled.
        if (el.disabled) continue;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        return { element: el, label: el.textContent.trim() };
      }
    }
    return null;
  }

  function looksLikeSubmitPage() {
    const submits = Array.from(
      document.querySelectorAll(
        "button[type='submit'], input[type='submit']"
      )
    );
    return submits.some((el) => {
      const text = (el.value || el.textContent || "").trim().toLowerCase();
      return /submit|apply|send/.test(text);
    });
  }

  function fillSelects(profile) {
    let count = 0;
    // Visa sponsorship — Greenhouse uses a select sometimes named
    // "job_application[answers_attributes][...][text_value]" with
    // pre-canned options, sometimes a radio group. For the select
    // case, we match on option text containing the user's answer.
    const visaSelects = document.querySelectorAll("select");
    if (profile.visaSponsorshipNeeded) {
      visaSelects.forEach((s) => {
        // Skip if this select isn't visa-related (basic heuristic via
        // name or surrounding label).
        const name = (s.getAttribute("name") || "").toLowerCase();
        const label = findTextareaLabel(s).toLowerCase();
        const haystack = name + " " + label;
        if (!/visa|sponsor/.test(haystack)) return;
        const target = profile.visaSponsorshipNeeded.toLowerCase();
        for (let i = 0; i < s.options.length; i += 1) {
          if (s.options[i].text.toLowerCase().includes(target.slice(0, 25))) {
            s.selectedIndex = i;
            s.dispatchEvent(new Event("change", { bubbles: true }));
            highlight(s);
            count += 1;
            break;
          }
        }
      });
    }
    return count;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => {
      switch (c) {
        case "&":
          return "&amp;";
        case "<":
          return "&lt;";
        case ">":
          return "&gt;";
        case '"':
          return "&quot;";
        case "'":
          return "&#39;";
        default:
          return c;
      }
    });
  }

  /** ------------------------------------------------------------------
   * Mount. Wait for body to exist (some ATS pages render late) then
   * attach the pill.
   * ------------------------------------------------------------------ */
  function mount() {
    if (document.getElementById(PILL_ID)) return;
    if (!document.body) {
      window.addEventListener("DOMContentLoaded", mount, { once: true });
      return;
    }
    document.body.appendChild(makePill());
  }

  mount();

  /** ------------------------------------------------------------------
   * Test hook. When this script is loaded into a JSDOM environment
   * for unit tests, the harness can flip
   * `window.__agenticJobOpsPillTestMode = true` BEFORE the script
   * runs to skip the chrome.* APIs and expose internals on a single
   * global namespace.
   * ------------------------------------------------------------------ */
  if (window.__agenticJobOpsPillTestMode) {
    window.__agenticJobOpsPill = {
      buildSelectorGroups,
      setReactValue,
      tryFill,
      fillCustomTextareas,
      fillSelects,
      normalizeLabel,
      escapeHtml,
      findContinueButton,
      looksLikeSubmitPage,
      mergeAnswerSources,
      attachSaveAnswerChips
    };
  }
})();
