import type { AppSession, ApplicationRecord, ApplicationStatus } from "../models/domain";
import { applicationRecordSchema } from "../models/schemas";
import { readJson, scopedKey, writeJson } from "../lib/storage";

function applicationsKey(session: AppSession): string {
  return scopedKey(session.tenant.id, session.userId, "applications");
}

export function loadApplications(session: AppSession): ApplicationRecord[] {
  const applications = readJson<ApplicationRecord[]>(applicationsKey(session), []);
  return applications.filter(
    (application) => applicationRecordSchema.safeParse(application).success
  );
}

export function saveApplications(
  session: AppSession,
  applications: ApplicationRecord[]
): ApplicationRecord[] {
  const parsed = applications.map((application) =>
    applicationRecordSchema.parse(application)
  );
  writeJson(applicationsKey(session), parsed);
  return parsed;
}

export function createApplicationRecord(
  session: AppSession,
  jobId: string,
  status: ApplicationStatus = "discovered",
  notes = ""
): ApplicationRecord {
  const timestamp = new Date().toISOString();

  return applicationRecordSchema.parse({
    id: `app_${globalThis.crypto.randomUUID()}`,
    tenantId: session.tenant.id,
    userId: session.userId,
    jobId,
    status,
    notes,
    createdAt: timestamp,
    updatedAt: timestamp
  });
}

export function upsertApplicationRecord(
  session: AppSession,
  jobId: string,
  updates: {
    status?: ApplicationStatus;
    notes?: string;
  }
): ApplicationRecord {
  const applications = loadApplications(session);
  const existing = applications.find((application) => application.jobId === jobId);
  const timestamp = new Date().toISOString();
  const nextRecord = existing
    ? applicationRecordSchema.parse({
        ...existing,
        status: updates.status ?? existing.status,
        notes: updates.notes ?? existing.notes,
        updatedAt: timestamp
      })
    : createApplicationRecord(
        session,
        jobId,
        updates.status ?? "discovered",
        updates.notes ?? ""
      );

  const nextApplications = existing
    ? applications.map((application) =>
        application.id === nextRecord.id ? nextRecord : application
      )
    : [nextRecord, ...applications];

  saveApplications(session, nextApplications);
  return nextRecord;
}

export function updateApplicationStatus(
  session: AppSession,
  applicationId: string,
  status: ApplicationStatus
): ApplicationRecord {
  const applications = loadApplications(session);
  const existing = applications.find((application) => application.id === applicationId);
  if (!existing) {
    throw new Error("Application record was not found.");
  }

  const updated = applicationRecordSchema.parse({
    ...existing,
    status,
    updatedAt: new Date().toISOString()
  });

  saveApplications(
    session,
    applications.map((application) =>
      application.id === applicationId ? updated : application
    )
  );
  return updated;
}

export function updateApplicationNotes(
  session: AppSession,
  applicationId: string,
  notes: string
): ApplicationRecord {
  const applications = loadApplications(session);
  const existing = applications.find((application) => application.id === applicationId);
  if (!existing) {
    throw new Error("Application record was not found.");
  }

  const updated = applicationRecordSchema.parse({
    ...existing,
    notes,
    updatedAt: new Date().toISOString()
  });

  saveApplications(
    session,
    applications.map((application) =>
      application.id === applicationId ? updated : application
    )
  );
  return updated;
}
