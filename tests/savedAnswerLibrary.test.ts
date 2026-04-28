import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { currentSession } from "../src/data/currentSession";
import {
  findSavedAnswer,
  loadSavedAnswers,
  normalizeQuestion,
  recordSavedAnswerUsed,
  upsertSavedAnswer
} from "../src/services/savedAnswerLibrary";

function installLocalStorageMock() {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, "window", {
    value: {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => store.set(key, value),
        removeItem: (key: string) => store.delete(key),
        clear: () => store.clear()
      }
    },
    configurable: true
  });
}

describe("normalizeQuestion — pure key derivation", () => {
  it("collapses case + punctuation + whitespace into a stable key", () => {
    const a = normalizeQuestion("Why are you interested in this role?");
    const b = normalizeQuestion("  why are you INTERESTED in this role  ");
    const c = normalizeQuestion("Why are you interested in this role!");
    expect(a).toBe(b);
    expect(a).toBe(c);
    expect(a).toBe("why are you interested in this role");
  });

  it("returns empty string for whitespace / punctuation-only input", () => {
    expect(normalizeQuestion("   ")).toBe("");
    expect(normalizeQuestion("???")).toBe("");
  });
});

describe("upsertSavedAnswer + findSavedAnswer", () => {
  beforeEach(() => installLocalStorageMock());
  afterEach(() => Reflect.deleteProperty(globalThis, "window"));

  it("creates a fresh entry on first call", () => {
    const created = upsertSavedAnswer(
      currentSession,
      "Why are you interested in this role?",
      "Because I like building reliable platforms."
    );
    expect(created).not.toBeNull();
    expect(created!.useCount).toBe(0);
    expect(created!.answer).toBe("Because I like building reliable platforms.");
    expect(loadSavedAnswers(currentSession)).toHaveLength(1);
  });

  it("updates the existing entry when the same normalized question is upserted", () => {
    upsertSavedAnswer(
      currentSession,
      "Why are you interested in this role?",
      "First version"
    );
    upsertSavedAnswer(
      currentSession,
      "  why are you INTERESTED in this role  ",
      "Revised version"
    );
    const all = loadSavedAnswers(currentSession);
    expect(all).toHaveLength(1);
    expect(all[0].answer).toBe("Revised version");
  });

  it("returns null (no-op) for empty answers / blank questions", () => {
    expect(
      upsertSavedAnswer(currentSession, "Why?", "")
    ).toBeNull();
    expect(
      upsertSavedAnswer(currentSession, "   ", "Answer")
    ).toBeNull();
    expect(loadSavedAnswers(currentSession)).toHaveLength(0);
  });

  it("findSavedAnswer matches case-insensitively", () => {
    upsertSavedAnswer(
      currentSession,
      "Why are you interested in this role?",
      "Stored answer"
    );
    expect(
      findSavedAnswer(currentSession, "Why are you interested in this role?")
    ).not.toBeNull();
    expect(
      findSavedAnswer(currentSession, "WHY ARE YOU INTERESTED IN THIS ROLE")
    ).not.toBeNull();
    expect(findSavedAnswer(currentSession, "Unrelated question")).toBeNull();
  });

  it("recordSavedAnswerUsed bumps useCount + lastUsedAt", () => {
    const created = upsertSavedAnswer(
      currentSession,
      "Q",
      "A"
    )!;
    const before = created.useCount;
    recordSavedAnswerUsed(currentSession, created.id);
    recordSavedAnswerUsed(currentSession, created.id);
    const after = loadSavedAnswers(currentSession).find(
      (entry) => entry.id === created.id
    )!;
    expect(after.useCount).toBe(before + 2);
  });

  it("recordSavedAnswerUsed is a no-op for an unknown id (never throws)", () => {
    expect(() =>
      recordSavedAnswerUsed(currentSession, "saved_answer_nonexistent")
    ).not.toThrow();
  });
});
