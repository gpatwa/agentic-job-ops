import type { AppSession, AuditLog } from "../models/domain";
import { auditLogSchema } from "../models/schemas";
import { readJson, scopedKey, writeJson } from "../lib/storage";

type AuditMetadata = AuditLog["metadata"];

interface AuditLogInput {
  action: string;
  resourceType: string;
  resourceId: string;
  metadata?: AuditMetadata;
}

function createId(prefix: string): string {
  return `${prefix}_${globalThis.crypto.randomUUID()}`;
}

function auditKey(session: AppSession): string {
  return scopedKey(session.tenant.id, session.userId, "audit_logs");
}

export function loadAuditLogs(session: AppSession): AuditLog[] {
  const logs = readJson<AuditLog[]>(auditKey(session), []);
  return logs.filter((log) => auditLogSchema.safeParse(log).success);
}

export function appendAuditLog(
  session: AppSession,
  input: AuditLogInput
): AuditLog {
  const log: AuditLog = {
    id: createId("audit"),
    tenantId: session.tenant.id,
    actorUserId: session.userId,
    action: input.action,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    metadata: input.metadata ?? {},
    createdAt: new Date().toISOString()
  };

  const parsed = auditLogSchema.parse(log);
  writeJson(auditKey(session), [parsed, ...loadAuditLogs(session)].slice(0, 50));
  return parsed;
}
