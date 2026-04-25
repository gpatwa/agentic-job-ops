import type { AppSession, JobSource, NormalizedJob } from "../models/domain";

export interface JobIngestionRequest {
  session: AppSession;
  source: JobSource;
  cursor?: string;
}

export interface JobIngestionResult {
  jobs: NormalizedJob[];
  nextCursor: string | null;
}

export interface JobIngestionConnector {
  source: JobSource;
  ingest(request: JobIngestionRequest): Promise<JobIngestionResult>;
}

export function createGreenhouseConnectorPlaceholder(): JobIngestionConnector {
  return {
    source: "greenhouse",
    async ingest() {
      throw new Error("Greenhouse ingestion is scheduled for Phase 2.");
    }
  };
}

export function createLeverConnectorPlaceholder(): JobIngestionConnector {
  return {
    source: "lever",
    async ingest() {
      throw new Error("Lever ingestion is scheduled for Phase 2.");
    }
  };
}
