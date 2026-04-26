/**
 * Agentic Job Ops background service worker.
 *
 * Orchestrates messages between the popup, the content script, and the local
 * Agentic Job Ops app. Holds no credentials, no cookies, and no field values
 * other than what the user explicitly approves to fill.
 *
 * The service worker maintains a small in-memory connection map keyed by tab
 * id. Persistent state lives in chrome.storage so the popup can resume after
 * the worker is suspended.
 */

const APP_ORIGINS = ["http://127.0.0.1:5174", "http://localhost:5174"];

const SESSION_STORAGE_KEY = "agentic-job-ops/active-session";

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] ?? null;
}

async function injectContentScript(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["src/contentScript.js"]
  });
}

async function loadActiveSession() {
  return new Promise((resolve) => {
    chrome.storage.local.get([SESSION_STORAGE_KEY], (data) => {
      resolve(data?.[SESSION_STORAGE_KEY] ?? null);
    });
  });
}

async function saveActiveSession(session) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [SESSION_STORAGE_KEY]: session }, () => resolve());
  });
}

async function clearActiveSession() {
  return new Promise((resolve) => {
    chrome.storage.local.remove([SESSION_STORAGE_KEY], () => resolve());
  });
}

function isAppOrigin(url) {
  if (!url) return false;
  return APP_ORIGINS.some((origin) => url.startsWith(origin));
}

async function requestPageStructure(tabId) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(
      tabId,
      { type: "agentic-job-ops/extract-page-structure" },
      (response) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, error: chrome.runtime.lastError.message });
          return;
        }
        resolve(response ?? { ok: false, error: "No response from content script" });
      }
    );
  });
}

async function applyFillPlanToTab(tabId, fields) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(
      tabId,
      { type: "agentic-job-ops/apply-fill-plan", fields },
      (response) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, error: chrome.runtime.lastError.message });
          return;
        }
        resolve(response ?? { ok: false, error: "No response from content script" });
      }
    );
  });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    if (!message || typeof message !== "object") {
      sendResponse({ ok: false, error: "Invalid message" });
      return;
    }

    if (message.type === "agentic-job-ops/connect-active-tab") {
      const tab = await getActiveTab();
      if (!tab || typeof tab.id !== "number") {
        sendResponse({ ok: false, error: "No active tab" });
        return;
      }
      if (isAppOrigin(tab.url || "")) {
        sendResponse({
          ok: false,
          error: "The active tab is the Agentic Job Ops app itself; switch to the application page first."
        });
        return;
      }
      const session = {
        tabId: tab.id,
        pageUrl: tab.url || "",
        pageTitle: tab.title || "",
        connectedAt: new Date().toISOString()
      };
      await saveActiveSession(session);
      try {
        await injectContentScript(tab.id);
      } catch (error) {
        sendResponse({
          ok: false,
          error: `Could not inject content script: ${String(error?.message || error)}`
        });
        return;
      }
      sendResponse({ ok: true, session });
      return;
    }

    if (message.type === "agentic-job-ops/get-active-session") {
      const session = await loadActiveSession();
      sendResponse({ ok: true, session });
      return;
    }

    if (message.type === "agentic-job-ops/extract") {
      const session = await loadActiveSession();
      if (!session) {
        sendResponse({ ok: false, error: "No connected session" });
        return;
      }
      const result = await requestPageStructure(session.tabId);
      sendResponse(result);
      return;
    }

    if (message.type === "agentic-job-ops/apply-fill-plan") {
      const session = await loadActiveSession();
      if (!session) {
        sendResponse({ ok: false, error: "No connected session" });
        return;
      }
      const result = await applyFillPlanToTab(session.tabId, message.fields || []);
      sendResponse(result);
      return;
    }

    if (message.type === "agentic-job-ops/disconnect") {
      await clearActiveSession();
      sendResponse({ ok: true });
      return;
    }

    sendResponse({ ok: false, error: `Unknown message type: ${message.type}` });
  })();

  return true;
});
