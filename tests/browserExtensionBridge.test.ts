// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { currentSession } from "../src/data/currentSession";
import {
  __resetExtensionBridgeForTesting,
  getExtensionBridgeStatus,
  pullCapturedSavedAnswers,
  subscribeExtensionBridgeStatus,
  syncProfileToExtension
} from "../src/services/browserExtensionBridge";
import {
  loadSavedAnswers,
  saveSavedAnswers
} from "../src/services/savedAnswerLibrary";

/**
 * The bridge service uses `window.postMessage` to exchange events
 * with the extension's dashboardBridge content script. We use jsdom
 * for the window + addEventListener implementation but DRIVE messages
 * via direct `dispatchEvent(new MessageEvent(...))` because jsdom's
 * postMessage is asynchronous and doesn't always reach listeners
 * within a sub-second test budget.
 *
 * Mirrors the localStorage stub pattern from companyJobDiscovery /
 * savedAnswerLibrary tests — jsdom in vitest doesn't always expose
 * a working localStorage, so we provide our own.
 */

function installLocalStorageMock() {
  const store = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
      clear: () => store.clear()
    },
    configurable: true,
    writable: true
  });
}

function deliverBridgeMessage(data: unknown): void {
  // Direct synchronous dispatch to bypass jsdom's async postMessage
  // queue. The bridge service treats `event.source !== window` as a
  // reject, so we explicitly set source to the active window.
  const event = new MessageEvent("message", {
    data,
    source: window as unknown as MessageEventSource
  });
  window.dispatchEvent(event);
}

describe("browserExtensionBridge — status subscription", () => {
  beforeEach(() => {
    __resetExtensionBridgeForTesting();
  });
  afterEach(() => {
    __resetExtensionBridgeForTesting();
  });

  it("starts with available=false / version=null / lastSyncedAt=null", () => {
    expect(getExtensionBridgeStatus()).toEqual({
      available: false,
      version: null,
      lastSyncedAt: null
    });
  });

  it("calls subscribers immediately with the current snapshot", () => {
    const onStatus = vi.fn();
    const unsub = subscribeExtensionBridgeStatus(onStatus);
    expect(onStatus).toHaveBeenCalledOnce();
    expect(onStatus).toHaveBeenCalledWith({
      available: false,
      version: null,
      lastSyncedAt: null
    });
    unsub();
  });

  it("stops invoking subscribers after unsubscribe", () => {
    const onStatus = vi.fn();
    const unsub = subscribeExtensionBridgeStatus(onStatus);
    unsub();
    onStatus.mockClear();
    subscribeExtensionBridgeStatus(() => undefined);
    expect(onStatus).not.toHaveBeenCalled();
  });
});

describe("syncProfileToExtension", () => {
  beforeEach(() => __resetExtensionBridgeForTesting());
  afterEach(() => __resetExtensionBridgeForTesting());

  it("resolves when an agentic:sync-acknowledged message arrives", async () => {
    const promise = syncProfileToExtension(
      {
        profile: null,
        activePackage: null,
        activeJob: null,
        activeAnswers: []
      },
      { timeoutMs: 1000 }
    );
    // Deliver the bridge ack synchronously after one event-loop turn
    // so the listener has installed.
    setTimeout(() => {
      deliverBridgeMessage({
        source: "agentic-bridge",
        type: "agentic:sync-acknowledged",
        syncedAt: "2026-04-29T01:00:00.000Z"
      });
    }, 0);
    const result = await promise;
    expect(result.syncedAt).toBe("2026-04-29T01:00:00.000Z");
    expect(getExtensionBridgeStatus().lastSyncedAt).toBe(
      "2026-04-29T01:00:00.000Z"
    );
    expect(getExtensionBridgeStatus().available).toBe(true);
  });

  it("rejects after timeout when no bridge replies", async () => {
    await expect(
      syncProfileToExtension(
        {
          profile: null,
          activePackage: null,
          activeJob: null,
          activeAnswers: []
        },
        { timeoutMs: 50 }
      )
    ).rejects.toThrow(/Extension bridge did not acknowledge/);
  });
});

describe("pullCapturedSavedAnswers", () => {
  beforeEach(() => {
    __resetExtensionBridgeForTesting();
    installLocalStorageMock();
    saveSavedAnswers(currentSession, []);
  });
  afterEach(() => __resetExtensionBridgeForTesting());

  it("merges entries into savedAnswerLibrary", async () => {
    const promise = pullCapturedSavedAnswers(currentSession, {
      timeoutMs: 1000
    });
    setTimeout(() => {
      deliverBridgeMessage({
        source: "agentic-bridge",
        type: "agentic:saved-answers",
        entries: [
          {
            question: "What's your favorite color?",
            answer: "Emerald.",
            capturedAt: "2026-04-29T01:00:00.000Z"
          },
          {
            question: "Why this role?",
            answer: "It aligns with my data-platform leadership work.",
            capturedAt: "2026-04-29T01:01:00.000Z"
          }
        ]
      });
    }, 0);
    const result = await promise;
    expect(result.mergedCount).toBe(2);
    const stored = loadSavedAnswers(currentSession);
    expect(stored).toHaveLength(2);
    expect(stored.map((s) => s.question).sort()).toEqual(
      ["What's your favorite color?", "Why this role?"].sort()
    );
  });

  it("ignores malformed entries (defensive)", async () => {
    const promise = pullCapturedSavedAnswers(currentSession, {
      timeoutMs: 1000
    });
    setTimeout(() => {
      deliverBridgeMessage({
        source: "agentic-bridge",
        type: "agentic:saved-answers",
        entries: [
          { question: "OK question", answer: "OK answer" },
          { question: "Missing answer" },
          null,
          { answer: "Missing question" }
        ]
      });
    }, 0);
    const result = await promise;
    expect(result.mergedCount).toBe(1);
  });

  it("rejects after timeout when no bridge responds", async () => {
    await expect(
      pullCapturedSavedAnswers(currentSession, { timeoutMs: 50 })
    ).rejects.toThrow(/Extension bridge did not respond/);
  });
});
