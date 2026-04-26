import type {
  AppSession,
  EventMetadata,
  FeedbackEvent,
  FeedbackEventType
} from "../models/domain";
import { feedbackEventSchema } from "../models/schemas";
import { readJson, scopedKey, writeJson } from "../lib/storage";

interface FeedbackEventInput {
  eventType: FeedbackEventType;
  resourceType: string;
  resourceId: string;
  metadata?: EventMetadata;
}

function createId(prefix: string): string {
  return `${prefix}_${globalThis.crypto.randomUUID()}`;
}

function feedbackKey(session: AppSession): string {
  return scopedKey(session.tenant.id, session.userId, "feedback_events");
}

export function loadFeedbackEvents(session: AppSession): FeedbackEvent[] {
  const events = readJson<FeedbackEvent[]>(feedbackKey(session), []);
  return events.filter((event) => feedbackEventSchema.safeParse(event).success);
}

export function saveFeedbackEvents(
  session: AppSession,
  events: FeedbackEvent[]
): FeedbackEvent[] {
  const parsed = events.map((event) => feedbackEventSchema.parse(event));
  writeJson(feedbackKey(session), parsed.slice(0, 500));
  return parsed;
}

export function appendFeedbackEvent(
  session: AppSession,
  input: FeedbackEventInput
): FeedbackEvent {
  const event = feedbackEventSchema.parse({
    id: createId("feedback"),
    tenantId: session.tenant.id,
    userId: session.userId,
    eventType: input.eventType,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    metadata: input.metadata ?? {},
    createdAt: new Date().toISOString()
  });

  saveFeedbackEvents(session, [event, ...loadFeedbackEvents(session)]);
  return event;
}

export function summarizeFeedbackEvents(events: FeedbackEvent[]): Record<string, number> {
  return events.reduce<Record<string, number>>((counts, event) => {
    counts[event.eventType] = (counts[event.eventType] ?? 0) + 1;
    return counts;
  }, {});
}
