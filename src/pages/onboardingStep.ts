import type {
  OnboardingState,
  Resume,
  ResumeIntelligenceReport
} from "../models/domain";

/**
 * Pure step-machine helpers for the onboarding flow. Lives outside
 * OnboardingPage.tsx so React Fast Refresh treats that file as a
 * pure-component module — mixing component and non-component exports
 * forces full reloads on every edit (see vitejs/vite-plugin-react
 * "consistent-components-exports" docs).
 *
 * The behaviour is unchanged: this module simply contains the type
 * and the step-resolution function previously colocated with the
 * page component.
 */
export type OnboardingStepId = "resume" | "intelligence" | "targets" | "jobs";

export function computeOnboardingStep(input: {
  resume: Resume | null;
  report: ResumeIntelligenceReport | null;
  state: OnboardingState;
  hasJobsShown: boolean;
}): OnboardingStepId {
  if (!input.resume) return "resume";
  if (!input.report) return "intelligence";
  if (input.state.selectedTargetRoles.length === 0) return "targets";
  if (input.hasJobsShown || input.state.firstApplyReadyJobsShown) return "jobs";
  return "targets";
}
