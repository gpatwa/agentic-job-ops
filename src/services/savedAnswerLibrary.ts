import type { AppSession, SavedApplicationAnswer } from "../models/domain";
import { savedApplicationAnswerSchema } from "../models/schemas";
import { readJson, scopedKey, writeJson } from "../lib/storage";

/**
 * Personal answer library — per (tenant, user).
 *
 * Lets the candidate write a great answer to "Why are you
 * interested in this kind of role?" once and reuse it across
 * dozens of applications. Two integration points:
 *
 *   1) `applicationPackage` calls `findSavedAnswer(session, q)`
 *      before each LLM call. Hit ⇒ skip the LLM for that question
 *      and surface the saved entry with `source: "saved_library"`.
 *
 *   2) When the candidate hits "Save answer" on the package page,
 *      App.tsx upserts the edited text into the library so the
 *      next application benefits from the refinement.
 *
 * Intentionally tiny — pure CRUD over localStorage, normalized
 * lookup, advisory `useCount` / `lastUsedAt` for a future "your
 * most-used answers" UI.
 */

function libraryKey(session: AppSession): string {
  return scopedKey(
    session.tenant.id,
    session.userId,
    "saved_application_answers"
  );
}

function nowIso(): string {
  return new Date().toISOString();
}

function createId(prefix: string): string {
  return `${prefix}_${globalThis.crypto.randomUUID()}`;
}

/**
 * Lower-case + collapse-punctuation form used as the lookup key.
 * "Why are you interested in this role?" and
 * "  why are you interested in this role  " both collapse to
 * "why are you interested in this role".
 */
export function normalizeQuestion(question: string): string {
  return question
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function loadSavedAnswers(
  session: AppSession
): SavedApplicationAnswer[] {
  return readJson<SavedApplicationAnswer[]>(libraryKey(session), []).filter(
    (entry) => savedApplicationAnswerSchema.safeParse(entry).success
  );
}

export function saveSavedAnswers(
  session: AppSession,
  entries: SavedApplicationAnswer[]
): SavedApplicationAnswer[] {
  const parsed = entries.map((entry) =>
    savedApplicationAnswerSchema.parse(entry)
  );
  writeJson(libraryKey(session), parsed);
  return parsed;
}

/**
 * Insert-or-update a (question, answer) pair in the library. Match
 * is by `normalizedQuestion` so trivial wording differences collapse
 * to one entry.
 *
 * Behavior:
 * - If no entry exists for this question, create a fresh one with
 *   `useCount: 0` and `lastUsedAt = createdAt`.
 * - If an entry exists, update its `answer`, bump `updatedAt`, and
 *   leave `useCount` / `lastUsedAt` untouched (those are bumped by
 *   `recordSavedAnswerUsed` when the library is consulted at
 *   generate time).
 * - Empty answer text is a no-op (avoids polluting the library with
 *   blank drafts).
 */
export function upsertSavedAnswer(
  session: AppSession,
  question: string,
  answer: string
): SavedApplicationAnswer | null {
  const trimmedAnswer = answer.trim();
  const trimmedQuestion = question.trim();
  if (trimmedAnswer.length === 0 || trimmedQuestion.length === 0) {
    return null;
  }
  const normalized = normalizeQuestion(trimmedQuestion);
  if (normalized.length === 0) {
    return null;
  }
  const all = loadSavedAnswers(session);
  const existing = all.find(
    (entry) => entry.normalizedQuestion === normalized
  );
  const timestamp = nowIso();
  if (existing) {
    const updated = savedApplicationAnswerSchema.parse({
      ...existing,
      // Prefer the latest spelling of the question — useful when
      // the user edits the question text in a future UI surface.
      question: trimmedQuestion,
      answer: trimmedAnswer,
      updatedAt: timestamp
    });
    saveSavedAnswers(
      session,
      all.map((entry) => (entry.id === updated.id ? updated : entry))
    );
    return updated;
  }
  const created = savedApplicationAnswerSchema.parse({
    id: createId("saved_answer"),
    tenantId: session.tenant.id,
    userId: session.userId,
    question: trimmedQuestion,
    normalizedQuestion: normalized,
    answer: trimmedAnswer,
    useCount: 0,
    lastUsedAt: timestamp,
    createdAt: timestamp,
    updatedAt: timestamp
  });
  saveSavedAnswers(session, [created, ...all]);
  return created;
}

export function findSavedAnswer(
  session: AppSession,
  question: string
): SavedApplicationAnswer | null {
  const normalized = normalizeQuestion(question);
  if (normalized.length === 0) {
    return null;
  }
  return (
    loadSavedAnswers(session).find(
      (entry) => entry.normalizedQuestion === normalized
    ) ?? null
  );
}

/**
 * Bump `useCount` + `lastUsedAt` after a library entry was reused
 * on a generated package. Best-effort: storage errors are
 * swallowed so a metadata write never blocks a generation flow.
 */
export function recordSavedAnswerUsed(
  session: AppSession,
  savedAnswerId: string
): void {
  try {
    const all = loadSavedAnswers(session);
    const entry = all.find((item) => item.id === savedAnswerId);
    if (!entry) {
      return;
    }
    const updated = savedApplicationAnswerSchema.parse({
      ...entry,
      useCount: entry.useCount + 1,
      lastUsedAt: nowIso(),
      updatedAt: nowIso()
    });
    saveSavedAnswers(
      session,
      all.map((item) => (item.id === updated.id ? updated : item))
    );
  } catch {
    /* advisory metadata; never fatal */
  }
}
