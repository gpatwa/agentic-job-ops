import type { ApplicationRecord } from "../models/domain";

export interface BrowserApplicationDraftRequest {
  application: ApplicationRecord;
  approvedByUser: boolean;
}

export interface BrowserApplicationAssistant {
  prepareDraft(request: BrowserApplicationDraftRequest): Promise<ApplicationRecord>;
}

export function createBrowserApplicationAssistantPlaceholder(): BrowserApplicationAssistant {
  return {
    async prepareDraft(request) {
      if (!request.approvedByUser) {
        throw new Error("Browser application actions require explicit user approval.");
      }

      throw new Error("Browser application assistance is scheduled for Phase 5.");
    }
  };
}
