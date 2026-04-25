import type { ApplicationRecord, NormalizedJob, UserProfile } from "../models/domain";

export interface ApplicationPackageRequest {
  application: ApplicationRecord;
  job: NormalizedJob;
  profile: UserProfile;
  approvedByUser: boolean;
}

export interface ApplicationPackageDraft {
  applicationId: string;
  resumeDraftUrl: string;
  coverLetterDraftUrl: string;
  status: "placeholder";
}

export interface ApplicationPackageGenerator {
  prepareDraft(request: ApplicationPackageRequest): Promise<ApplicationPackageDraft>;
}

export function createApplicationPackageGeneratorPlaceholder(): ApplicationPackageGenerator {
  return {
    async prepareDraft(request) {
      if (!request.approvedByUser) {
        throw new Error("Application package generation requires explicit user approval.");
      }

      throw new Error("Tailored application packages are scheduled for Phase 5.");
    }
  };
}
