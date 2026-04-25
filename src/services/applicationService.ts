import type { AppSession, ApplicationRecord } from "../models/domain";
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
