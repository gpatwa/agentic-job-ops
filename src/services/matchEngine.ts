import type { JobMatch, NormalizedJob, UserProfile } from "../models/domain";

export interface MatchEngineInput {
  profile: UserProfile;
  jobs: NormalizedJob[];
}

export interface MatchEngine {
  scoreJobs(input: MatchEngineInput): Promise<JobMatch[]>;
}

export function createMatchEnginePlaceholder(): MatchEngine {
  return {
    async scoreJobs() {
      throw new Error("Job scoring is scheduled for Phase 3.");
    }
  };
}
