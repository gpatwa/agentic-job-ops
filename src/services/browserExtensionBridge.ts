import type {
  ApplicationAnswer,
  ApplicationPackage,
  AppSession,
  NormalizedJob,
  UserProfile
} from "../models/domain";
import { upsertSavedAnswer } from "./savedAnswerLibrary";

/**
 * Browser-extension bridge.
 *
 * Two-way `window.postMessage` channel between the dashboard and the
 * extension's `dashboardBridge.js` content script (auto-injected on
 * localhost:5173). Replaces the bookmarklet UX with the Simplify-style
 * "install once, click extension on the application page" pattern.
 *
 * Flow:
 *   1. Extension is installed → its bridge content script runs on this
 *      page → posts `agentic:bridge-ready` on load.
 *   2. Dashboard listens for that message; flips `bridgeAvailable: true`
 *      so the UI can show "Extension installed" instead of the install
 *      CTA.
 *   3. When the user clicks "Sync to extension" on a Browser Assistant
 *      page, dashboard posts `agentic:sync-profile` with the candidate's
 *      profile + active package + answers + job. Bridge stores it in
 *      chrome.storage.local under a versioned key.
 *   4. The pill content script (running on Greenhouse / Lever pages)
 *      reads from chrome.storage on click and fills the form.
 *
 * Why postMessage and not chrome.runtime.sendMessage from the page:
 *   - sendMessage requires the dashboard to know the extension's ID.
 *     postMessage works without coupling the two — the bridge listens,
 *     the page broadcasts.
 *   - The bridge content script enforces origin scoping via the
 *     manifest's content_scripts.matches glob (localhost:5173 only).
 *
 * No-op fallback: if the bridge is not present (no extension), every
 * postMessage call falls through silently. The UI always shows the
 * install CTA in that state.
 */

const MESSAGE_SOURCE_DASHBOARD = "agentic-dashboard";
const MESSAGE_SOURCE_BRIDGE = "agentic-bridge";

export interface ExtensionBridgeStatus {
  /** True when we have heard from the bridge content script. */
  available: boolean;
  /** Extension version reported in bridge-ready / pong. */
  version: string | null;
  /** ISO timestamp of the most recent successful sync, or null. */
  lastSyncedAt: string | null;
}

export interface SyncProfilePayload {
  profile: UserProfile | null;
  activePackage: ApplicationPackage | null;
  activeJob: NormalizedJob | null;
  activeAnswers: ApplicationAnswer[];
}

type BridgeListener = (status: ExtensionBridgeStatus) => void;

/**
 * Module-level state. Singleton because there's only one extension per
 * tab and the listeners are mounted once at app load.
 */
let currentStatus: ExtensionBridgeStatus = {
  available: false,
  version: null,
  lastSyncedAt: null
};
const subscribers = new Set<BridgeListener>();
let listenerInstalled = false;

function setStatus(next: ExtensionBridgeStatus): void {
  currentStatus = next;
  subscribers.forEach((cb) => {
    try {
      cb(next);
    } catch {
      /* listener errors must not break sibling listeners */
    }
  });
}

/**
 * Install the message listener exactly once. Safe to call from every
 * React component that needs the status — repeat calls are no-ops.
 */
export function installExtensionBridgeListener(): void {
  if (listenerInstalled) return;
  if (typeof window === "undefined") return;
  listenerInstalled = true;
  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const data = event.data as
      | { source?: string; type?: string; version?: string; syncedAt?: string }
      | undefined;
    if (!data || typeof data !== "object") return;
    if (data.source !== MESSAGE_SOURCE_BRIDGE) return;
    if (
      data.type === "agentic:bridge-ready" ||
      data.type === "agentic:pong"
    ) {
      setStatus({
        ...currentStatus,
        available: true,
        version: data.version ?? null
      });
      return;
    }
    if (data.type === "agentic:sync-acknowledged") {
      setStatus({
        ...currentStatus,
        available: true,
        lastSyncedAt: data.syncedAt ?? new Date().toISOString()
      });
      return;
    }
  });
  // Immediately send a ping so an already-loaded bridge can acknowledge
  // without waiting for its next bridge-ready broadcast.
  window.postMessage(
    { source: MESSAGE_SOURCE_DASHBOARD, type: "agentic:ping" },
    window.location.origin
  );
}

export function subscribeExtensionBridgeStatus(
  listener: BridgeListener
): () => void {
  subscribers.add(listener);
  // Push current snapshot synchronously so the caller doesn't have to
  // wait for the next bridge event.
  listener(currentStatus);
  return () => {
    subscribers.delete(listener);
  };
}

export function getExtensionBridgeStatus(): ExtensionBridgeStatus {
  return currentStatus;
}

/**
 * Push the candidate's profile + active package context to the
 * extension. Resolves once we get an `agentic:sync-acknowledged` reply,
 * or rejects after a 3-second timeout if no bridge is listening.
 *
 * The acknowledgment path also flips `lastSyncedAt` on the cached
 * status, which the UI uses to render "Synced N seconds ago".
 */
export function syncProfileToExtension(
  payload: SyncProfilePayload,
  options: { timeoutMs?: number } = {}
): Promise<{ syncedAt: string }> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined") {
      reject(new Error("syncProfileToExtension requires a browser environment"));
      return;
    }
    const timeoutMs = options.timeoutMs ?? 3000;
    let settled = false;
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window) return;
      const data = event.data as
        | { source?: string; type?: string; syncedAt?: string }
        | undefined;
      if (!data || typeof data !== "object") return;
      if (data.source !== MESSAGE_SOURCE_BRIDGE) return;
      if (data.type !== "agentic:sync-acknowledged") return;
      if (settled) return;
      settled = true;
      window.removeEventListener("message", onMessage);
      const syncedAt = data.syncedAt ?? new Date().toISOString();
      setStatus({
        ...currentStatus,
        available: true,
        lastSyncedAt: syncedAt
      });
      resolve({ syncedAt });
    };
    window.addEventListener("message", onMessage);
    setTimeout(() => {
      if (settled) return;
      settled = true;
      window.removeEventListener("message", onMessage);
      reject(
        new Error(
          "Extension bridge did not acknowledge sync within " +
            timeoutMs +
            "ms. Is the Agentic browser extension installed?"
        )
      );
    }, timeoutMs);

    window.postMessage(
      {
        source: MESSAGE_SOURCE_DASHBOARD,
        type: "agentic:sync-profile",
        profile: payload.profile,
        activePackage: payload.activePackage,
        activeJob: payload.activeJob,
        activeAnswers: payload.activeAnswers
      },
      window.location.origin
    );
  });
}

export interface CapturedSavedAnswer {
  question: string;
  answer: string;
  capturedAt: string;
  capturedFromUrl?: string;
}

/**
 * Pull every {question, answer} pair the pill captured since the last
 * dashboard visit, merge them into the local SavedApplicationAnswer
 * library via upsertSavedAnswer, then signal the bridge to clear its
 * buffer so we don't merge them twice.
 *
 * The acknowledgment race here is asymmetric: the bridge replies with
 * `agentic:saved-answers` carrying the buffer; we merge synchronously
 * (localStorage is fast enough) and only THEN post `agentic:clear-
 * saved-answers` to wipe the buffer. If the user closes the dashboard
 * tab before clearing, the same captures will arrive on the next
 * visit and re-merge (idempotent — upsertSavedAnswer is keyed on the
 * normalized question).
 */
export function pullCapturedSavedAnswers(
  session: AppSession,
  options: { timeoutMs?: number } = {}
): Promise<{ mergedCount: number }> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined") {
      reject(
        new Error("pullCapturedSavedAnswers requires a browser environment")
      );
      return;
    }
    const timeoutMs = options.timeoutMs ?? 3000;
    let settled = false;
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window) return;
      const data = event.data as
        | { source?: string; type?: string; entries?: unknown }
        | undefined;
      if (!data || typeof data !== "object") return;
      if (data.source !== MESSAGE_SOURCE_BRIDGE) return;
      if (data.type !== "agentic:saved-answers") return;
      if (settled) return;
      settled = true;
      window.removeEventListener("message", onMessage);

      const entries = Array.isArray(data.entries)
        ? (data.entries as CapturedSavedAnswer[])
        : [];
      let mergedCount = 0;
      for (const entry of entries) {
        if (
          !entry ||
          typeof entry.question !== "string" ||
          typeof entry.answer !== "string"
        ) {
          continue;
        }
        const result = upsertSavedAnswer(session, entry.question, entry.answer);
        if (result) mergedCount += 1;
      }
      // Tell the bridge to wipe the buffer now that we've merged.
      window.postMessage(
        {
          source: MESSAGE_SOURCE_DASHBOARD,
          type: "agentic:clear-saved-answers"
        },
        window.location.origin
      );
      resolve({ mergedCount });
    };
    window.addEventListener("message", onMessage);
    setTimeout(() => {
      if (settled) return;
      settled = true;
      window.removeEventListener("message", onMessage);
      reject(
        new Error(
          "Extension bridge did not respond to saved-answers request within " +
            timeoutMs +
            "ms."
        )
      );
    }, timeoutMs);
    window.postMessage(
      {
        source: MESSAGE_SOURCE_DASHBOARD,
        type: "agentic:request-saved-answers"
      },
      window.location.origin
    );
  });
}

/**
 * Test reset hook. Wipes module-level state so tests start clean.
 */
export function __resetExtensionBridgeForTesting(): void {
  currentStatus = {
    available: false,
    version: null,
    lastSyncedAt: null
  };
  subscribers.clear();
  listenerInstalled = false;
}
