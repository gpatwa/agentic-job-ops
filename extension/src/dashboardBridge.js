/**
 * Dashboard bridge content script.
 *
 * Auto-injected by the manifest on http://localhost:5173/* and
 * 127.0.0.1:5173 (dev). Acts as the trusted boundary between the
 * Agentic Job Ops dashboard (running in the page) and the browser
 * extension's chrome.storage.
 *
 * Why a content script:
 *   - The dashboard cannot call chrome.runtime.* directly because it
 *     runs as a normal web page, not as the extension context.
 *   - A content script CAN, because Chrome injects a fresh JS context
 *     into the page that has access to the chrome.* APIs.
 *   - We use the standard window.postMessage pattern as the page-to-
 *     content-script boundary. The page posts an "agentic:sync"
 *     message; we receive it, extract the {profile, package, answers,
 *     job} payload, and store it via chrome.storage.local under a
 *     versioned key. The pill content script (running on Greenhouse /
 *     Lever pages) reads from chrome.storage on click and fills the
 *     form.
 *
 * Privacy contract:
 *   - The bridge ONLY accepts messages whose origin is localhost:5173
 *     (enforced by the manifest content_scripts.matches; this script
 *     only runs there).
 *   - Each message must carry { source: "agentic-dashboard" } as a
 *     sanity check against accidental cross-talk with other extensions
 *     or browser noise.
 *   - The sync payload includes the candidate's profile values + the
 *     active package's drafts. It never leaves the user's machine —
 *     chrome.storage.local is per-extension, per-machine.
 */

// Single-source-of-truth keys. Bumping the suffix invalidates old
// payloads after a breaking shape change.
const STORAGE_KEY = "agentic-job-ops/sync-v1";
const SAVED_ANSWERS_KEY = "agentic-job-ops/saved-answers-v1";

// Matches what the dashboard posts via window.postMessage.
const MESSAGE_SOURCE = "agentic-dashboard";

window.addEventListener("message", (event) => {
  // Only accept messages whose source is the same window. Manifest
  // already pins this to localhost:5173, but defense-in-depth.
  if (event.source !== window) return;
  const data = event.data;
  if (!data || typeof data !== "object") return;
  if (data.source !== MESSAGE_SOURCE) return;

  if (data.type === "agentic:sync-profile") {
    const payload = {
      profile: data.profile ?? null,
      activePackage: data.activePackage ?? null,
      activeJob: data.activeJob ?? null,
      activeAnswers: Array.isArray(data.activeAnswers) ? data.activeAnswers : [],
      syncedAt: new Date().toISOString()
    };
    chrome.storage.local.set({ [STORAGE_KEY]: payload }, () => {
      // Acknowledge back to the page so the dashboard can show "synced".
      window.postMessage(
        {
          source: "agentic-bridge",
          type: "agentic:sync-acknowledged",
          syncedAt: payload.syncedAt
        },
        window.location.origin
      );
    });
    return;
  }

  if (data.type === "agentic:ping") {
    // Used by the dashboard to detect "extension is installed".
    window.postMessage(
      {
        source: "agentic-bridge",
        type: "agentic:pong",
        version: chrome.runtime.getManifest().version
      },
      window.location.origin
    );
    return;
  }

  if (data.type === "agentic:request-saved-answers") {
    // Dashboard is asking "what answers has the pill captured since
    // the last sync?" — we read chrome.storage and post them back so
    // the dashboard can merge into savedAnswerLibrary.upsertSavedAnswer.
    // After a successful merge the dashboard sends
    // `agentic:clear-saved-answers` to wipe the buffer.
    chrome.storage.local.get([SAVED_ANSWERS_KEY], (stored) => {
      const captured = (stored && stored[SAVED_ANSWERS_KEY]) || [];
      window.postMessage(
        {
          source: "agentic-bridge",
          type: "agentic:saved-answers",
          entries: captured
        },
        window.location.origin
      );
    });
    return;
  }

  if (data.type === "agentic:clear-saved-answers") {
    // Dashboard confirms it has merged the buffer into the canonical
    // SavedApplicationAnswer library; safe to wipe so we don't
    // re-deliver the same captures twice.
    chrome.storage.local.set({ [SAVED_ANSWERS_KEY]: [] });
    return;
  }
});

// Announce ourselves on load so a listening dashboard can flip its
// "extension installed" indicator without the user having to ping.
window.postMessage(
  {
    source: "agentic-bridge",
    type: "agentic:bridge-ready",
    version: chrome.runtime.getManifest().version
  },
  window.location.origin
);
