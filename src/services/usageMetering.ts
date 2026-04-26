import type {
  AppSession,
  EventMetadata,
  UsageMeteringEvent,
  UsageMeteringEventType
} from "../models/domain";
import { usageMeteringEventSchema } from "../models/schemas";
import { readJson, scopedKey, writeJson } from "../lib/storage";

interface UsageMeteringInput {
  eventType: UsageMeteringEventType;
  resourceType: string;
  resourceId: string;
  quantity?: number;
  unit?: string;
  metadata?: EventMetadata;
}

function createId(prefix: string): string {
  return `${prefix}_${globalThis.crypto.randomUUID()}`;
}

function usageKey(session: AppSession): string {
  return scopedKey(session.tenant.id, session.userId, "usage_metering_events");
}

export function loadUsageMeteringEvents(session: AppSession): UsageMeteringEvent[] {
  const events = readJson<UsageMeteringEvent[]>(usageKey(session), []);
  return events.filter((event) => usageMeteringEventSchema.safeParse(event).success);
}

export function saveUsageMeteringEvents(
  session: AppSession,
  events: UsageMeteringEvent[]
): UsageMeteringEvent[] {
  const parsed = events.map((event) => usageMeteringEventSchema.parse(event));
  writeJson(usageKey(session), parsed.slice(0, 1000));
  return parsed;
}

export function appendUsageMeteringEvent(
  session: AppSession,
  input: UsageMeteringInput
): UsageMeteringEvent {
  const event = usageMeteringEventSchema.parse({
    id: createId("usage"),
    tenantId: session.tenant.id,
    userId: session.userId,
    eventType: input.eventType,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    quantity: input.quantity ?? 1,
    unit: input.unit ?? "count",
    metadata: input.metadata ?? {},
    createdAt: new Date().toISOString()
  });

  saveUsageMeteringEvents(session, [event, ...loadUsageMeteringEvents(session)]);
  return event;
}

export function summarizeUsageByEvent(
  events: UsageMeteringEvent[]
): Record<string, number> {
  return events.reduce<Record<string, number>>((counts, event) => {
    counts[event.eventType] = (counts[event.eventType] ?? 0) + event.quantity;
    return counts;
  }, {});
}

export function summarizeUsageByTenant(
  events: UsageMeteringEvent[]
): Record<string, number> {
  return events.reduce<Record<string, number>>((counts, event) => {
    counts[event.tenantId] = (counts[event.tenantId] ?? 0) + event.quantity;
    return counts;
  }, {});
}
