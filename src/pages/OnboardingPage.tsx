import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  BookmarkPlus,
  CheckCircle2,
  Eye,
  FileText,
  FileUp,
  RefreshCw,
  Rocket,
  ShieldAlert,
  Sparkles,
  Target,
  XCircle
} from "lucide-react";
import type {
  ApplicationRecord,
  AtsRiskLevel,
  ExtractedResumeProfile,
  JobMatch,
  JobTargetRecommendation,
  NormalizedJob,
  OnboardingState,
  RecommendedRole,
  Resume,
  ResumeFieldConfidence,
  ResumeImprovementDraft,
  ResumeIntelligenceReport,
  UserProfile
} from "../models/domain";
import type { OnboardingRecommendationResult } from "../services/onboardingJobRecommendationService";
import { isDemoJob } from "../services/onboardingJobRecommendationService";
import { selectionFromRecommendation } from "../services/resumeIntelligenceService";
import {
  assessResumeTextQuality,
  canRunResumeIntelligence,
  describeResumeQualityForCustomer,
  type ResumeTextQuality
} from "../services/resumeTextQuality";
import type { ApiParseDiagnostic } from "../services/resumeParseApiClient";
import type { ApiAiProbe } from "../services/resumeIntelligenceApiClient";
import type {
  OnboardingJobImportOverrides,
  OnboardingJobImportResult
} from "../services/onboardingJobUrlImport";
import { computeOnboardingStep, type OnboardingStepId } from "./onboardingStep";

interface OnboardingPageProps {
  profile: UserProfile | null;
  resume: Resume | null;
  state: OnboardingState;
  applications: ApplicationRecord[];
  isRecommending: boolean;
  lastResult: OnboardingRecommendationResult | null;
  resumeIntelligenceReport: ResumeIntelligenceReport | null;
  jobTargetRecommendation: JobTargetRecommendation | null;
  resumeImprovementDraft: ResumeImprovementDraft | null;
  isAnalyzingResume: boolean;
  isImprovingResume: boolean;
  onGenerateImprovement: () => void;
  onEditImprovement: (markdown: string) => void;
  onSaveImprovement: () => void;
  onReanalyzeImprovement: () => void;
  onRejectImprovement: () => void;
  /**
   * Latest server-side parse diagnostic. Threaded through to the
   * Resume Intelligence section so the parsing-issue card can show
   * the structured likely-cause / recommended-fix from the server
   * (overriding the locally-derived assessResumeTextQuality copy
   * when present).
   */
  lastParseDiagnostic: ApiParseDiagnostic | null;
  /**
   * Latest AI round-trip probe (cached on the server for 60 s).
   * Threaded into the LLM-unavailable card so the customer sees
   * the specific failure category (timeout / http_4xx /
   * json_parse / etc.) instead of generic "currently
   * unavailable" copy.
   */
  aiProbe: ApiAiProbe | null;
  onPasteResumeText: (text: string) => void;
  onUploadResumeFile: (
    file: File
  ) => Promise<{ extractionPending: boolean; fileName: string; extension: string }>;
  onTryDemoProfile: () => void;
  onTryRealisticDemo: () => void;
  onAnalyzeResume: () => void;
  onConfirmResumeProfile: () => void;
  onConfirmRecommendedTargets: (selection: {
    selectedRoles: string[];
    selectedIndustries: string[];
    recommendedSeniority: string;
  }) => void;
  onSelectRoles: (roles: string[]) => void;
  onGenerateRecommendations: (roles: string[]) => void;
  onReviewJob: (jobId: string) => void;
  onStartApplicationPrep: (jobId: string) => void;
  onImportJobFromUrl: (
    url: string,
    overrides?: OnboardingJobImportOverrides
  ) => Promise<{
    job: OnboardingJobImportResult["job"];
    parsedUrl: OnboardingJobImportResult["parsedUrl"];
    isDuplicate: boolean;
    needsManualEnrichment: boolean;
    match: JobMatch | null;
  }>;
  onApplyJobOverrides: (
    jobId: string,
    overrides: OnboardingJobImportOverrides
  ) => Promise<void>;
  onSaveJob: (jobId: string) => void;
  onDismissJob: (jobId: string) => void;
  onCompleteOnboarding: (
    reason: "user_chose_dashboard" | "user_started_review" | "user_started_prep"
  ) => void;
  onNavigateProfile: () => void;
  onNavigateResume: () => void;
  onNavigateDashboard: () => void;
  onNavigateJobQueue: () => void;
}

const STEP_ORDER: OnboardingStepId[] = ["resume", "intelligence", "targets", "jobs"];

function isStepCompleted(
  step: OnboardingStepId,
  current: OnboardingStepId,
  state: OnboardingState,
  resume: Resume | null,
  report: ResumeIntelligenceReport | null
): boolean {
  if (step === "resume") return Boolean(resume);
  if (step === "intelligence") return Boolean(report);
  if (step === "targets") return state.selectedTargetRoles.length > 0;
  if (step === "jobs") {
    return Boolean(state.onboardingCompletedAt) || state.firstJobReviewed;
  }
  return false;
}

const SUGGESTED_ROLES = [
  "Senior Product Manager",
  "Staff Product Manager",
  "Senior Software Engineer",
  "Staff Software Engineer",
  "Senior Data Scientist",
  "Senior Data Engineer",
  "Senior Product Designer",
  "Growth Marketing Lead",
  "Senior Operations Manager"
];

function statusLabel(value: string): string {
  return value.replace(/_/g, " ");
}

function StatusPill({
  tone,
  children
}: {
  tone: "good" | "warn" | "neutral";
  children: React.ReactNode;
}) {
  const palette =
    tone === "good"
      ? "bg-emerald-50 text-emerald-700"
      : tone === "warn"
        ? "bg-amber-50 text-amber-700"
        : "bg-slate-100 text-slate-700";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold capitalize ${palette}`}
    >
      {children}
    </span>
  );
}

export function OnboardingPage({
  profile,
  resume,
  state,
  applications,
  isRecommending,
  lastResult,
  resumeIntelligenceReport,
  jobTargetRecommendation,
  resumeImprovementDraft,
  isAnalyzingResume,
  isImprovingResume,
  onGenerateImprovement,
  onEditImprovement,
  onSaveImprovement,
  onReanalyzeImprovement,
  onRejectImprovement,
  lastParseDiagnostic,
  aiProbe,
  onPasteResumeText,
  onUploadResumeFile,
  onTryDemoProfile,
  onTryRealisticDemo,
  onAnalyzeResume,
  onConfirmResumeProfile,
  onConfirmRecommendedTargets,
  onSelectRoles,
  onGenerateRecommendations,
  onReviewJob,
  onStartApplicationPrep,
  onImportJobFromUrl,
  onApplyJobOverrides,
  onSaveJob,
  onDismissJob,
  onCompleteOnboarding,
  onNavigateProfile,
  onNavigateResume,
  onNavigateDashboard,
  onNavigateJobQueue
}: OnboardingPageProps) {
  const currentStep = computeOnboardingStep({
    resume,
    report: resumeIntelligenceReport,
    state,
    hasJobsShown: Boolean(lastResult)
  });
  const completedSteps = useMemo(
    () => ({
      resume: isStepCompleted("resume", currentStep, state, resume, resumeIntelligenceReport),
      intelligence: isStepCompleted(
        "intelligence",
        currentStep,
        state,
        resume,
        resumeIntelligenceReport
      ),
      targets: isStepCompleted("targets", currentStep, state, resume, resumeIntelligenceReport),
      jobs: isStepCompleted("jobs", currentStep, state, resume, resumeIntelligenceReport)
    }),
    [currentStep, state, resume, resumeIntelligenceReport]
  );
  const profileTargetTitles = useMemo(
    () => profile?.targetTitles ?? [],
    [profile?.targetTitles]
  );

  const [selectedRoles, setSelectedRoles] = useState<string[]>(() => {
    if (state.selectedTargetRoles.length > 0) {
      return state.selectedTargetRoles;
    }
    return profileTargetTitles;
  });
  const [customRoleDraft, setCustomRoleDraft] = useState("");

  const dismissedJobIds = useMemo(
    () =>
      new Set(
        applications
          .filter((app) => app.status === "rejected" || app.status === "archived")
          .map((app) => app.jobId)
      ),
    [applications]
  );
  const savedJobIds = useMemo(
    () =>
      new Set(
        applications
          .filter((app) => app.status === "saved" || app.status === "draft_prepared")
          .map((app) => app.jobId)
      ),
    [applications]
  );

  function toggleRole(role: string) {
    setSelectedRoles((prev) =>
      prev.includes(role)
        ? prev.filter((item) => item !== role)
        : [...prev, role]
    );
  }

  function addCustomRole() {
    const trimmed = customRoleDraft.trim();
    if (!trimmed) return;
    setSelectedRoles((prev) =>
      prev.includes(trimmed) ? prev : [...prev, trimmed]
    );
    setCustomRoleDraft("");
  }

  function handleSaveSelection() {
    onSelectRoles(selectedRoles);
  }

  function handleGenerate() {
    onGenerateRecommendations(selectedRoles);
  }

  // Render every role the user might want to keep checked: the
  // generic suggestions, anything pulled from their profile, AND
  // the current selection (which includes both the confirmed
  // LLM-recommended roles and any custom roles the user typed).
  // Without `selectedRoles` in this union, custom roles added via
  // the "Add role" button vanished — they were saved to state but
  // never got a chip, so the input cleared and the click looked
  // like a no-op.
  const allSuggestedAndProfile = useMemo(() => {
    const set = new Set<string>([
      ...profileTargetTitles,
      ...SUGGESTED_ROLES,
      ...selectedRoles
    ]);
    return Array.from(set);
  }, [profileTargetTitles, selectedRoles]);

  const onboardingComplete = Boolean(state.onboardingCompletedAt);

  const headlineCopy = adjustHeadlineForJobsResult(
    headlineForStep(currentStep, Boolean(lastResult)),
    lastResult,
    currentStep
  );
  const showResumeStep = currentStep === "resume";
  const showIntelligenceStep =
    currentStep === "intelligence" ||
    currentStep === "targets" ||
    currentStep === "jobs";
  const showTargetsStep = currentStep === "targets" || currentStep === "jobs";
  const showJobsStep = currentStep === "jobs";

  return (
    <div className="space-y-6">
      <header className="max-w-3xl">
        <p className="text-sm font-semibold uppercase tracking-wide text-emerald-700">
          Onboarding
        </p>
        <h2 className="mt-2 text-3xl font-semibold text-slate-950">
          {headlineCopy.title}
        </h2>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          {headlineCopy.subtitle}
        </p>
      </header>

      <Stepper currentStep={currentStep} completed={completedSteps} />

      {showJobsStep && lastResult && (
        <RecommendedNextActionHero
          result={lastResult}
          onReviewJob={(jobId) => {
            onReviewJob(jobId);
            onCompleteOnboarding("user_started_review");
            onNavigateJobQueue();
          }}
          onStartApplicationPrep={(jobId) => {
            onStartApplicationPrep(jobId);
            onCompleteOnboarding("user_started_prep");
          }}
          onGoToDashboard={() => {
            onCompleteOnboarding("user_chose_dashboard");
            onNavigateDashboard();
          }}
        />
      )}

      {showResumeStep ? (
        <ResumeStartCard
          isAnalyzing={isAnalyzingResume}
          onPasteResumeText={onPasteResumeText}
          onUploadResumeFile={onUploadResumeFile}
          onTryDemoProfile={onTryDemoProfile}
          onTryRealisticDemo={onTryRealisticDemo}
          onSkipToManualSetup={onNavigateProfile}
        />
      ) : (
        resume && (
          <ExistingResumeBanner
            resume={resume}
            onUploadResumeFile={onUploadResumeFile}
            onNavigateResume={onNavigateResume}
            isAnalyzing={isAnalyzingResume}
          />
        )
      )}

      {showIntelligenceStep && (
        <ResumeIntelligenceSection
          resume={resume}
          report={resumeIntelligenceReport}
          recommendation={jobTargetRecommendation}
          improvementDraft={resumeImprovementDraft}
          isAnalyzing={isAnalyzingResume}
          isImproving={isImprovingResume}
          parseDiagnostic={lastParseDiagnostic}
          aiProbe={aiProbe}
          onAnalyzeResume={onAnalyzeResume}
          onPasteResumeText={onPasteResumeText}
          onGenerateImprovement={onGenerateImprovement}
          onEditImprovement={onEditImprovement}
          onSaveImprovement={onSaveImprovement}
          onReanalyzeImprovement={onReanalyzeImprovement}
          onRejectImprovement={onRejectImprovement}
          onConfirmResumeProfile={onConfirmResumeProfile}
          onConfirmRecommendedTargets={(selection) => {
            onConfirmRecommendedTargets(selection);
            setSelectedRoles(selection.selectedRoles);
          }}
          onNavigateResume={onNavigateResume}
        />
      )}

      {showTargetsStep && (
        <section className="rounded-lg border border-line bg-white p-5 shadow-soft">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-emerald-50 text-emerald-700">
              <Target aria-hidden="true" size={18} />
            </div>
            <div className="flex-1">
              <h3 className="text-base font-semibold text-slate-950">
                Confirm your target roles
              </h3>
              <p className="mt-1 text-sm leading-6 text-slate-600">
                {jobTargetRecommendation &&
                jobTargetRecommendation.strongestRoles.length > 0
                  ? "Your confirmed targets from the AI analysis are checked below. Add or remove roles, or type a custom one."
                  : "We pre-selected from your resume. Add or remove roles, then show jobs you can act on now."}
              </p>

              {/*
                When the AI has provided focused recommendations,
                the generic SUGGESTED_ROLES chip set (Senior PM,
                Senior Software Engineer, Senior Data Scientist…)
                is noise — they don't apply to a senior leadership
                resume and just dilute the user's actual selection.
                In that case we render only the currently-selected
                chips (which include the AI-confirmed roles + any
                custom roles typed via the input below) so the user
                sees what they're actually committing to.
              */}
              {jobTargetRecommendation &&
              jobTargetRecommendation.strongestRoles.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  {selectedRoles.length === 0 ? (
                    <p className="text-xs text-slate-500">
                      No targets selected. Re-confirm in the AI analysis above
                      or add a custom role below.
                    </p>
                  ) : (
                    selectedRoles.map((role) => (
                      <button
                        key={role}
                        type="button"
                        className="rounded-full border border-emerald-700 bg-emerald-50 px-3 py-1 text-sm font-medium text-emerald-800"
                        onClick={() => toggleRole(role)}
                        title="Click to remove"
                      >
                        ✓ {role}
                      </button>
                    ))
                  )}
                </div>
              ) : (
                <>
                  {profileTargetTitles.length > 0 && (
                    <p className="mt-3 text-xs uppercase tracking-wide text-slate-500">
                      From your profile
                    </p>
                  )}
                  <div className="mt-2 flex flex-wrap gap-2">
                    {allSuggestedAndProfile.map((role) => {
                      const checked = selectedRoles.includes(role);
                      return (
                        <button
                          key={role}
                          type="button"
                          className={`rounded-full border px-3 py-1 text-sm font-medium transition ${
                            checked
                              ? "border-emerald-700 bg-emerald-50 text-emerald-800"
                              : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                          }`}
                          onClick={() => toggleRole(role)}
                        >
                          {checked ? "✓ " : ""}
                          {role}
                        </button>
                      );
                    })}
                  </div>
                </>
              )}

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  placeholder="Add a custom role (e.g. Senior PM, Workflow Automation)"
                  className="min-w-[260px] flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
                  value={customRoleDraft}
                  onChange={(e) => setCustomRoleDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addCustomRole();
                    }
                  }}
                />
                <button
                  type="button"
                  className="inline-flex min-h-10 items-center justify-center rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                  onClick={addCustomRole}
                >
                  Add role
                </button>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-ink px-3 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-400"
                  onClick={() => {
                    handleSaveSelection();
                    handleGenerate();
                  }}
                  disabled={selectedRoles.length === 0 || isRecommending}
                >
                  {isRecommending ? (
                    <RefreshCw className="animate-spin" aria-hidden="true" size={16} />
                  ) : (
                    <Sparkles aria-hidden="true" size={16} />
                  )}
                  {isRecommending ? "Finding jobs…" : "Show apply-ready jobs"}
                </button>
              </div>
            </div>
          </div>
        </section>
      )}

      {showTargetsStep && (
        <OnboardingJobUrlImport
          onImportJobFromUrl={onImportJobFromUrl}
          onApplyJobOverrides={onApplyJobOverrides}
          onStartApplicationPrep={(jobId) => {
            onStartApplicationPrep(jobId);
            onCompleteOnboarding("user_started_prep");
          }}
        />
      )}

      {showJobsStep && lastResult && (
        <RecommendationsSection
          result={lastResult}
          dismissedJobIds={dismissedJobIds}
          savedJobIds={savedJobIds}
          onReviewJob={(jobId) => {
            onReviewJob(jobId);
            onCompleteOnboarding("user_started_review");
            onNavigateJobQueue();
          }}
          onStartApplicationPrep={(jobId) => {
            onStartApplicationPrep(jobId);
            onCompleteOnboarding("user_started_prep");
          }}
          onSaveJob={onSaveJob}
          onDismissJob={onDismissJob}
        />
      )}

      {showJobsStep && !lastResult && state.firstApplyReadyJobsShown && (
        <section className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          Recommendations were shown earlier in another session. Generate again
          to refresh the list.
        </section>
      )}

      <footer className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-white p-4 shadow-soft">
        <span className="text-sm text-slate-600">
          {onboardingComplete
            ? "You can come back to onboarding any time from the sidebar."
            : "Prefer to fill things in by hand? Skip to manual setup."}
        </span>
        <div className="ml-auto flex flex-wrap gap-2">
          <button
            type="button"
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            onClick={onNavigateProfile}
          >
            Skip to manual setup
          </button>
          <button
            type="button"
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            onClick={() => {
              onCompleteOnboarding("user_chose_dashboard");
              onNavigateDashboard();
            }}
          >
            Go to dashboard
            <ArrowRight aria-hidden="true" size={16} />
          </button>
        </div>
      </footer>
    </div>
  );
}

function headlineForStep(
  step: OnboardingStepId,
  hasJobs: boolean
): { title: string; subtitle: string } {
  if (step === "resume") {
    return {
      title: "Start with your resume",
      subtitle:
        "Upload, paste, or try a demo profile. We use it to recommend roles you can act on right away."
    };
  }
  if (step === "intelligence") {
    return {
      title: "Let's see what your resume says",
      subtitle:
        "We analyze your resume locally to spot ATS issues and recommend realistic target roles. Output is estimated — you stay in control."
    };
  }
  if (step === "targets") {
    return {
      title: "Confirm a couple of target roles",
      subtitle:
        "We pre-selected roles based on your resume. Adjust the picks, then we'll show jobs you can apply to now."
    };
  }
  if (hasJobs) {
    // Honest only when there are real strong/possible matches.
    // adjustHeadlineForJobsResult overrides the title when the
    // run actually returned 0 strong + 0 possible matches so the
    // user doesn't see the contradictory "We found jobs" / "We
    // couldn't find a great match" pair on the same screen.
    return {
      title: "We found jobs you can apply to now.",
      subtitle:
        "Strong matches first. Review one, save it for later, or start a draft application package."
    };
  }
  return {
    title: "We're lining up jobs to show you",
    subtitle: "Confirm targets above and we'll show jobs in seconds."
  };
}

/**
 * Override the cheery "We found jobs" headline when the run
 * actually returned zero strong + zero possible matches (the
 * common case for a senior leadership resume against the demo
 * job seed). Without this, the page renders a contradictory pair:
 * top headline says "we found jobs", banner below says "we
 * couldn't find a great match".
 */
function adjustHeadlineForJobsResult(
  base: { title: string; subtitle: string },
  lastResult: OnboardingRecommendationResult | null,
  currentStep: OnboardingStepId
): { title: string; subtitle: string } {
  if (currentStep !== "jobs" || !lastResult) return base;
  const strongCount =
    lastResult.groups.find((group) => group.label === "Strong matches")
      ?.matches.length ?? 0;
  const possibleCount =
    lastResult.groups.find((group) => group.label === "Possible matches")
      ?.matches.length ?? 0;
  if (strongCount > 0 || possibleCount > 0) return base;
  return {
    title: "No strong matches yet — add a real job source.",
    subtitle:
      "We could only seed off-target demo jobs for your selected roles. Add a real source on the Ingestion page (or paste a specific job URL above) to see real matches."
  };
}

function Stepper({
  currentStep,
  completed
}: {
  currentStep: OnboardingStepId;
  completed: Record<OnboardingStepId, boolean>;
}) {
  const steps: { id: OnboardingStepId; label: string }[] = [
    { id: "resume", label: "Resume" },
    { id: "intelligence", label: "Intelligence" },
    { id: "targets", label: "Targets" },
    { id: "jobs", label: "Jobs" }
  ];
  return (
    <ol className="flex flex-wrap gap-2 rounded-lg border border-line bg-white p-3 shadow-soft">
      {steps.map((step, index) => {
        const isCurrent = step.id === currentStep;
        const isComplete = completed[step.id];
        const tone = isComplete
          ? "border-emerald-300 bg-emerald-50 text-emerald-800"
          : isCurrent
            ? "border-ink bg-ink text-white"
            : "border-slate-200 bg-white text-slate-500";
        return (
          <li
            key={step.id}
            className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold ${tone}`}
          >
            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-current text-[10px]">
              {index + 1}
            </span>
            {step.label}
            {isComplete && !isCurrent && (
              <CheckCircle2 aria-hidden="true" size={13} />
            )}
          </li>
        );
      })}
    </ol>
  );
}

function CompletedStepBanner({
  label,
  value,
  actionLabel,
  onAction
}: {
  label: string;
  value: string;
  actionLabel: string;
  onAction: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
      <CheckCircle2 aria-hidden="true" size={14} />
      <span className="font-semibold uppercase tracking-wide">{label}</span>
      <span className="truncate text-emerald-800">{value}</span>
      <button
        type="button"
        className="ml-auto text-xs font-semibold text-emerald-800 underline-offset-2 hover:underline"
        onClick={onAction}
      >
        {actionLabel}
      </button>
    </div>
  );
}

interface ImportedJobState {
  job: OnboardingJobImportResult["job"];
  parsedUrl: OnboardingJobImportResult["parsedUrl"];
  match: JobMatch | null;
  needsManualEnrichment: boolean;
  isDuplicate: boolean;
}

function describeImportSource(parsed: OnboardingJobImportResult["parsedUrl"]): string {
  if (parsed.source === "greenhouse") return "Greenhouse";
  if (parsed.source === "lever") return "Lever";
  if (parsed.detectedHostname) return `external (${parsed.detectedHostname})`;
  return "external";
}

function recommendationLabel(match: JobMatch | null): string {
  if (!match) return "Pending score";
  switch (match.recommendation) {
    case "apply":
      return "Strong match";
    case "maybe":
      return "Possible match";
    case "browse":
      return "Browse";
    case "skip":
    default:
      return "Skip / low match";
  }
}

function recommendationTone(match: JobMatch | null): string {
  if (!match) return "bg-slate-100 text-slate-700";
  switch (match.recommendation) {
    case "apply":
      return "bg-emerald-100 text-emerald-800";
    case "maybe":
      return "bg-amber-100 text-amber-800";
    default:
      return "bg-slate-100 text-slate-700";
  }
}

function OnboardingJobUrlImport({
  onImportJobFromUrl,
  onApplyJobOverrides,
  onStartApplicationPrep
}: {
  onImportJobFromUrl: OnboardingPageProps["onImportJobFromUrl"];
  onApplyJobOverrides: OnboardingPageProps["onApplyJobOverrides"];
  onStartApplicationPrep: (jobId: string) => void;
}) {
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState<
    | { kind: "idle" }
    | { kind: "detecting" }
    | { kind: "imported"; isDuplicate: boolean; needsManualEnrichment: boolean }
    | { kind: "needs_manual"; reason: string }
    | { kind: "scored"; score: number }
    | { kind: "ready_for_prep" }
    | { kind: "error"; message: string }
  >({ kind: "idle" });
  const [imported, setImported] = useState<ImportedJobState | null>(null);
  const [titleDraft, setTitleDraft] = useState("");
  const [companyDraft, setCompanyDraft] = useState("");
  const [locationDraft, setLocationDraft] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  function statusText(): string {
    switch (status.kind) {
      case "idle":
        return "";
      case "detecting":
        return "Detecting source…";
      case "imported":
        return status.isDuplicate
          ? status.needsManualEnrichment
            ? "Already imported · still needs manual details"
            : "Already imported"
          : status.needsManualEnrichment
            ? "Imported · needs manual details"
            : "Imported";
      case "needs_manual":
        return `Needs manual details: ${status.reason}`;
      case "scored":
        return `Scored ${status.score.toFixed(1)}/10`;
      case "ready_for_prep":
        return "Ready for application prep";
      case "error":
        return status.message;
    }
  }

  async function handleImportClick() {
    const trimmed = url.trim();
    if (trimmed.length === 0) {
      setStatus({ kind: "error", message: "Paste a job URL to import." });
      return;
    }
    setIsSubmitting(true);
    setStatus({ kind: "detecting" });
    try {
      const result = await onImportJobFromUrl(trimmed);
      setImported({
        job: result.job,
        parsedUrl: result.parsedUrl,
        match: result.match,
        needsManualEnrichment: result.needsManualEnrichment,
        isDuplicate: result.isDuplicate
      });
      setTitleDraft("");
      setCompanyDraft("");
      setLocationDraft("");
      if (result.needsManualEnrichment) {
        setStatus({
          kind: "imported",
          isDuplicate: result.isDuplicate,
          needsManualEnrichment: true
        });
      } else if (result.match) {
        setStatus({ kind: "scored", score: result.match.overallScore });
      } else {
        setStatus({
          kind: "imported",
          isDuplicate: result.isDuplicate,
          needsManualEnrichment: false
        });
      }
    } catch (error) {
      setStatus({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : "We couldn't import that URL. Double-check the link and try again."
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleApplyOverridesClick() {
    if (!imported) return;
    const overrides: OnboardingJobImportOverrides = {};
    if (titleDraft.trim().length > 0) overrides.title = titleDraft.trim();
    if (companyDraft.trim().length > 0) overrides.company = companyDraft.trim();
    if (locationDraft.trim().length > 0) overrides.location = locationDraft.trim();
    if (Object.keys(overrides).length === 0) return;
    setIsSubmitting(true);
    try {
      await onApplyJobOverrides(imported.job.id, overrides);
      // Re-import (idempotent) so the component picks up the freshly-
      // scored match for the same job id.
      const refreshed = await onImportJobFromUrl(imported.job.applicationUrl);
      setImported({
        job: refreshed.job,
        parsedUrl: refreshed.parsedUrl,
        match: refreshed.match,
        needsManualEnrichment: refreshed.needsManualEnrichment,
        isDuplicate: true
      });
      if (refreshed.match) {
        setStatus({ kind: "scored", score: refreshed.match.overallScore });
      }
    } catch (error) {
      setStatus({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : "We couldn't save those details. Try again."
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleStartPrepClick() {
    if (!imported) return;
    setStatus({ kind: "ready_for_prep" });
    onStartApplicationPrep(imported.job.id);
  }

  return (
    <section
      className="rounded-lg border border-line bg-white p-5 shadow-soft"
      data-testid="onboarding-job-url-section"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-emerald-50 text-emerald-700">
          <Target aria-hidden="true" size={18} />
        </div>
        <div className="flex-1">
          <h3 className="text-base font-semibold text-slate-950">
            Have a job already? Paste the job URL.
          </h3>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            Drop in a posting from Greenhouse, Lever, or any company careers
            page. We import a local job record, score it against your resume,
            and let you start application prep — without leaving onboarding.
            We never auto-submit; the final submit always requires your
            explicit approval.
          </p>

          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <input
              type="url"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              placeholder="https://job-boards.greenhouse.io/{company}/jobs/{id}"
              className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              data-testid="onboarding-job-url-input"
              disabled={isSubmitting}
            />
            <button
              type="button"
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-emerald-600 px-3 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-400"
              data-testid="onboarding-import-job-url"
              onClick={handleImportClick}
              disabled={isSubmitting || url.trim().length === 0}
            >
              <Sparkles aria-hidden="true" size={15} />
              {isSubmitting ? "Importing…" : "Import job"}
            </button>
          </div>

          {status.kind !== "idle" && (
            <p
              className={`mt-2 text-xs font-semibold ${
                status.kind === "error"
                  ? "text-red-700"
                  : status.kind === "scored" || status.kind === "ready_for_prep"
                    ? "text-emerald-800"
                    : "text-slate-700"
              }`}
              data-testid="onboarding-job-url-status"
              role={status.kind === "error" ? "alert" : "status"}
            >
              {statusText()}
            </p>
          )}

          {imported && (
            <div
              className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900"
              data-testid="onboarding-imported-job-card"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">
                  {imported.job.title}
                </span>
                <span className="text-emerald-800">·</span>
                <span>{imported.job.company}</span>
                <span className="text-emerald-800">·</span>
                <span className="text-emerald-800">
                  {imported.job.location}
                </span>
                <span className="ml-auto rounded-md bg-white px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-emerald-800">
                  Source: {describeImportSource(imported.parsedUrl)}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <span
                  data-testid="onboarding-imported-job-score"
                  className={`rounded-md px-2 py-0.5 text-xs font-semibold uppercase tracking-wide ${recommendationTone(
                    imported.match
                  )}`}
                >
                  Score: {imported.match
                    ? `${imported.match.overallScore.toFixed(1)} / 10`
                    : "pending"}
                </span>
                <span className="rounded-md bg-white px-2 py-0.5 text-xs font-semibold text-emerald-800">
                  {recommendationLabel(imported.match)}
                </span>
                {imported.needsManualEnrichment && (
                  <span className="rounded-md bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">
                    Low confidence (description incomplete)
                  </span>
                )}
              </div>

              {imported.match && imported.match.topMatchReasons.length > 0 && (
                <div className="mt-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
                    Top match reasons
                  </p>
                  <ul className="mt-1 space-y-1 text-xs leading-5 text-emerald-900">
                    {imported.match.topMatchReasons.slice(0, 3).map((line) => (
                      <li key={line}>• {line}</li>
                    ))}
                  </ul>
                </div>
              )}
              {imported.match && imported.match.topGaps.length > 0 && (
                <div className="mt-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">
                    Top gaps
                  </p>
                  <ul className="mt-1 space-y-1 text-xs leading-5 text-amber-900">
                    {imported.match.topGaps.slice(0, 3).map((line) => (
                      <li key={line}>• {line}</li>
                    ))}
                  </ul>
                </div>
              )}
              {imported.match &&
                imported.match.employerLookingFor.length > 0 && (
                  <div className="mt-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-700">
                      What the employer appears to want
                    </p>
                    <ul className="mt-1 space-y-1 text-xs leading-5 text-slate-700">
                      {imported.match.employerLookingFor
                        .slice(0, 3)
                        .map((line) => (
                          <li key={line}>• {line}</li>
                        ))}
                    </ul>
                  </div>
                )}

              {imported.needsManualEnrichment && (
                <div className="mt-3 rounded-md border border-amber-300 bg-white p-3 text-amber-900">
                  <p className="text-xs">
                    We detected this as a {describeImportSource(imported.parsedUrl)} job.
                    Full details could not be fetched locally, so add missing
                    details below or run enrichment later. Scoring confidence
                    is limited until the description is filled in.
                  </p>
                  <div className="mt-2 grid gap-2 sm:grid-cols-3">
                    <input
                      type="text"
                      placeholder="Job title"
                      className="rounded-md border border-slate-300 px-2 py-1 text-xs"
                      value={titleDraft}
                      onChange={(event) => setTitleDraft(event.target.value)}
                      data-testid="onboarding-job-url-title-input"
                      disabled={isSubmitting}
                    />
                    <input
                      type="text"
                      placeholder="Company"
                      className="rounded-md border border-slate-300 px-2 py-1 text-xs"
                      value={companyDraft}
                      onChange={(event) => setCompanyDraft(event.target.value)}
                      data-testid="onboarding-job-url-company-input"
                      disabled={isSubmitting}
                    />
                    <input
                      type="text"
                      placeholder="Location"
                      className="rounded-md border border-slate-300 px-2 py-1 text-xs"
                      value={locationDraft}
                      onChange={(event) => setLocationDraft(event.target.value)}
                      data-testid="onboarding-job-url-location-input"
                      disabled={isSubmitting}
                    />
                  </div>
                  <button
                    type="button"
                    className="mt-2 inline-flex min-h-9 items-center justify-center gap-2 rounded-md border border-amber-400 bg-amber-50 px-3 text-xs font-semibold text-amber-900 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
                    data-testid="onboarding-job-url-apply-overrides"
                    onClick={handleApplyOverridesClick}
                    disabled={
                      isSubmitting ||
                      [titleDraft, companyDraft, locationDraft]
                        .map((value) => value.trim())
                        .every((value) => value.length === 0)
                    }
                  >
                    Apply manual details
                  </button>
                </div>
              )}

              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-ink px-3 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-400"
                  data-testid="onboarding-start-prep-from-url"
                  onClick={handleStartPrepClick}
                  disabled={isSubmitting}
                >
                  <Rocket aria-hidden="true" size={15} />
                  Start application prep
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

/**
 * Customer-friendly explanation of an AI probe error category.
 * The diagnostic detail (model name, raw HTTP body) lives in the
 * Probe pill below — this copy is the "what should I do" summary.
 */
function unavailableCopyForCategory(
  category: NonNullable<ApiAiProbe["errorCategory"]>
): string {
  switch (category) {
    case "not_configured":
      return "AI service has no provider configured on the server. Set OPENAI_API_KEY (or the Azure equivalents) and restart the API.";
    case "network":
      return "We couldn't reach the AI provider — the API server may be offline or there's no internet connection from it. Try again shortly.";
    case "timeout":
      return "The AI provider didn't respond in time. Try again — if it keeps timing out, switch to a faster model.";
    case "http_4xx":
      return "The AI provider rejected our request — usually a configuration mismatch (wrong model name, deprecated parameter, missing permission). Operator action required.";
    case "http_5xx":
      return "The AI provider returned a server error. This is usually transient — try again in a moment.";
    case "json_parse":
      return "The AI provider returned a malformed response. The output may have been truncated. Try again; if it persists, raise the completion-token limit.";
    case "unknown":
    default:
      return "AI analysis is currently unavailable for an unrecognised reason. Try again in a moment, or contact your operator.";
  }
}

/** File extensions accepted by the onboarding upload control. */
const ONBOARDING_RESUME_ACCEPT = ".pdf,.doc,.docx,.txt,.md";

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface UploadStatusState {
  fileName: string;
  extractionPending: boolean;
}

function ResumeStartCard({
  isAnalyzing,
  onPasteResumeText,
  onUploadResumeFile,
  onTryDemoProfile,
  onTryRealisticDemo,
  onSkipToManualSetup
}: {
  isAnalyzing: boolean;
  onPasteResumeText: (text: string) => void;
  onUploadResumeFile: (
    file: File
  ) => Promise<{ extractionPending: boolean; fileName: string; extension: string }>;
  onTryDemoProfile: () => void;
  onTryRealisticDemo: () => void;
  onSkipToManualSetup: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [pasteError, setPasteError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadStatus, setUploadStatus] = useState<UploadStatusState | null>(
    null
  );
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  async function handleUpload() {
    if (!selectedFile) return;
    setUploadError(null);
    setIsUploading(true);
    try {
      const result = await onUploadResumeFile(selectedFile);
      setUploadStatus({
        fileName: result.fileName,
        extractionPending: result.extractionPending
      });
      setSelectedFile(null);
    } catch (error) {
      setUploadStatus(null);
      setUploadError(
        error instanceof Error
          ? error.message
          : "We couldn't read that file. Use a PDF, DOC, DOCX, TXT, or MD resume."
      );
    } finally {
      setIsUploading(false);
    }
  }

  function handlePaste() {
    const trimmed = draft.trim();
    if (trimmed.length < 50) {
      setPasteError(
        "Paste at least a few lines of resume text so the analyzer has something to work with."
      );
      return;
    }
    setPasteError(null);
    onPasteResumeText(trimmed);
    setDraft("");
  }

  const uploadDisabled = !selectedFile || isAnalyzing || isUploading;

  return (
    <section className="rounded-lg border border-line bg-white p-5 shadow-soft">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-emerald-50 text-emerald-700">
          <FileText aria-hidden="true" size={18} />
        </div>
        <div className="flex-1">
          <h3 className="text-base font-semibold text-slate-950">
            Add your resume
          </h3>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            Upload a resume file or paste text. We use it to recommend roles
            and prepare applications. We keep it private and never log the
            content.
          </p>

          <div className="mt-4 rounded-md border border-slate-200 bg-panel p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Upload a resume file
            </p>
            <label className="mt-2 flex cursor-pointer flex-col items-start gap-2 rounded-md border border-dashed border-slate-300 bg-white p-3 hover:border-emerald-500">
              <span className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                <FileUp aria-hidden="true" size={16} />
                {selectedFile
                  ? `${selectedFile.name} · ${formatFileSize(selectedFile.size)}`
                  : "Choose a resume file"}
              </span>
              <span className="text-xs text-slate-500">
                Accepted: PDF, DOC, DOCX, TXT, MD. TXT/MD are parsed locally;
                PDF/DOC/DOCX record metadata and mark text extraction as
                pending until a parser runs.
              </span>
              <input
                className="sr-only"
                type="file"
                accept={ONBOARDING_RESUME_ACCEPT}
                data-testid="onboarding-resume-file-input"
                onChange={(event) => {
                  setUploadError(null);
                  setSelectedFile(event.target.files?.[0] ?? null);
                }}
              />
            </label>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-emerald-600 px-3 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-400"
                data-testid="onboarding-upload-resume"
                onClick={handleUpload}
                disabled={uploadDisabled}
              >
                <FileUp aria-hidden="true" size={15} />
                {isUploading ? "Uploading…" : "Upload resume"}
              </button>
              {uploadError && (
                <p className="text-xs text-red-700" role="alert">
                  {uploadError}
                </p>
              )}
            </div>
            {uploadStatus && (
              <p
                className="mt-2 text-xs text-emerald-800"
                data-testid="onboarding-resume-upload-status"
              >
                ✓ Uploaded {uploadStatus.fileName}
                {uploadStatus.extractionPending
                  ? " · text extraction pending"
                  : " · text parsed locally"}
              </p>
            )}
          </div>

          <div className="mt-4 rounded-md border border-slate-200 bg-panel p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Or paste resume text
            </p>
            <textarea
              className="mt-2 min-h-32 w-full rounded-md border border-slate-300 px-3 py-2 text-sm leading-6"
              placeholder="Paste resume text here…"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
            {pasteError && (
              <p className="mt-1 text-xs text-red-700">{pasteError}</p>
            )}
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-ink px-3 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-400"
                onClick={handlePaste}
                disabled={isAnalyzing || draft.trim().length === 0}
              >
                <Sparkles aria-hidden="true" size={15} />
                Save resume and continue
              </button>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 text-sm font-semibold text-amber-900 hover:bg-amber-100"
              data-testid="try-realistic-demo"
              onClick={onTryRealisticDemo}
              disabled={isAnalyzing}
            >
              Try realistic demo
            </button>
            <button
              type="button"
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              onClick={onTryDemoProfile}
              disabled={isAnalyzing}
            >
              Add demo resume only
            </button>
            <button
              type="button"
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              onClick={onSkipToManualSetup}
            >
              Skip to manual setup
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * Banner shown on Step 1 when a resume already exists. Lets the user
 * replace it inline (preserving the prior version in history via the
 * upload handler's promoteResumeAsActive call) or jump to the dedicated
 * Resume page to manage versions.
 */
function ExistingResumeBanner({
  resume,
  onUploadResumeFile,
  onNavigateResume,
  isAnalyzing
}: {
  resume: Resume;
  onUploadResumeFile: (
    file: File
  ) => Promise<{ extractionPending: boolean; fileName: string; extension: string }>;
  onNavigateResume: () => void;
  isAnalyzing: boolean;
}) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadStatus, setUploadStatus] = useState<UploadStatusState | null>(
    null
  );
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  async function handleReplace() {
    if (!selectedFile) return;
    setUploadError(null);
    setIsUploading(true);
    try {
      const result = await onUploadResumeFile(selectedFile);
      setUploadStatus({
        fileName: result.fileName,
        extractionPending: result.extractionPending
      });
      setSelectedFile(null);
    } catch (error) {
      setUploadStatus(null);
      setUploadError(
        error instanceof Error
          ? error.message
          : "We couldn't read that file. Use a PDF, DOC, DOCX, TXT, or MD resume."
      );
    } finally {
      setIsUploading(false);
    }
  }

  const replaceDisabled = !selectedFile || isAnalyzing || isUploading;

  return (
    <section
      className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900"
      data-testid="onboarding-resume-completed"
    >
      <div className="flex flex-wrap items-center gap-2">
        <CheckCircle2 aria-hidden="true" size={14} />
        <span className="font-semibold uppercase tracking-wide">Resume</span>
        <span className="truncate text-emerald-800">
          {resume.originalFileName}
        </span>
        <button
          type="button"
          className="ml-auto text-xs font-semibold text-emerald-800 underline-offset-2 hover:underline"
          onClick={onNavigateResume}
        >
          Manage resume versions
        </button>
      </div>
      <div className="mt-3 rounded-md border border-emerald-200 bg-white p-3 text-slate-700">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Replace or upload an improved resume
        </p>
        <label className="mt-2 flex cursor-pointer items-center gap-2 rounded-md border border-dashed border-slate-300 px-3 py-2 text-xs font-semibold text-slate-800 hover:border-emerald-500">
          <FileUp aria-hidden="true" size={14} />
          {selectedFile
            ? `${selectedFile.name} · ${formatFileSize(selectedFile.size)}`
            : "Choose a different resume file"}
          <input
            className="sr-only"
            type="file"
            accept={ONBOARDING_RESUME_ACCEPT}
            data-testid="onboarding-resume-file-input"
            onChange={(event) => {
              setUploadError(null);
              setSelectedFile(event.target.files?.[0] ?? null);
            }}
          />
        </label>
        <p className="mt-2 text-xs text-slate-500">
          Replacing keeps the prior version accessible from Manage resume
          versions. We never log the file contents.
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="inline-flex min-h-9 items-center justify-center gap-2 rounded-md bg-emerald-600 px-3 text-xs font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-400"
            data-testid="onboarding-replace-resume"
            onClick={handleReplace}
            disabled={replaceDisabled}
          >
            <FileUp aria-hidden="true" size={13} />
            {isUploading ? "Replacing…" : "Replace resume"}
          </button>
          {uploadError && (
            <p className="text-xs text-red-700" role="alert">
              {uploadError}
            </p>
          )}
        </div>
        {uploadStatus && (
          <p
            className="mt-2 text-xs text-emerald-800"
            data-testid="onboarding-resume-upload-status"
          >
            ✓ Uploaded {uploadStatus.fileName}
            {uploadStatus.extractionPending
              ? " · text extraction pending"
              : " · text parsed locally"}
          </p>
        )}
      </div>
    </section>
  );
}

function RecommendedNextActionHero({
  result,
  onReviewJob,
  onStartApplicationPrep,
  onGoToDashboard
}: {
  result: OnboardingRecommendationResult;
  onReviewJob: (jobId: string) => void;
  onStartApplicationPrep: (jobId: string) => void;
  onGoToDashboard: () => void;
}) {
  const strong = result.groups.find(
    (group) => group.label === "Strong matches"
  );
  const possible = result.groups.find(
    (group) => group.label === "Possible matches"
  );
  const top = strong?.matches[0] ?? possible?.matches[0] ?? null;

  if (!top) {
    return (
      <section className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        We couldn't find a great match this run. Add a job source on the
        Ingestion page or try a different target role.
      </section>
    );
  }

  const isStrong = strong?.matches.includes(top);
  return (
    <section className="rounded-lg border border-emerald-200 bg-emerald-50 p-5 shadow-soft">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
            Recommended next action
          </p>
          <h3 className="mt-1 text-lg font-semibold text-emerald-950">
            {isStrong
              ? "Start a draft application for your strongest match."
              : "Review your top possible match."}
          </h3>
          <p className="mt-1 text-sm leading-6 text-emerald-900">
            {top.job.title} — {top.job.company} · Match{" "}
            <strong>{top.match.overallScore.toFixed(1)}</strong> / 10
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="inline-flex min-h-10 items-center gap-2 rounded-md border border-emerald-300 bg-white px-3 text-sm font-semibold text-emerald-800 hover:bg-emerald-100"
            onClick={() => onReviewJob(top.job.id)}
          >
            <Eye aria-hidden="true" size={15} />
            Review job
          </button>
          <button
            type="button"
            className="inline-flex min-h-10 items-center gap-2 rounded-md bg-emerald-700 px-3 text-sm font-semibold text-white hover:bg-emerald-800"
            onClick={() => onStartApplicationPrep(top.job.id)}
          >
            <Rocket aria-hidden="true" size={15} />
            Start application prep
          </button>
          <button
            type="button"
            className="inline-flex min-h-10 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            onClick={onGoToDashboard}
          >
            Go to dashboard
          </button>
        </div>
      </div>
    </section>
  );
}

function ReadinessCard({
  title,
  status,
  tone,
  actionLabel,
  onAction
}: {
  title: string;
  status: string;
  tone: "good" | "warn" | "neutral";
  actionLabel: string;
  onAction: () => void;
}) {
  return (
    <div className="rounded-lg border border-line bg-white p-4 shadow-soft">
      <p className="text-sm font-medium text-slate-500">{title}</p>
      <p
        className={`mt-2 text-base font-semibold ${
          tone === "good"
            ? "text-emerald-700"
            : tone === "warn"
              ? "text-amber-700"
              : "text-slate-800"
        }`}
      >
        {status}
      </p>
      <button
        type="button"
        className="mt-3 inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
        onClick={onAction}
      >
        {actionLabel}
        <ArrowRight aria-hidden="true" size={12} />
      </button>
    </div>
  );
}

interface RecommendationsSectionProps {
  result: OnboardingRecommendationResult;
  dismissedJobIds: Set<string>;
  savedJobIds: Set<string>;
  onReviewJob: (jobId: string) => void;
  onStartApplicationPrep: (jobId: string) => void;
  onSaveJob: (jobId: string) => void;
  onDismissJob: (jobId: string) => void;
}

function RecommendationsSection({
  result,
  dismissedJobIds,
  savedJobIds,
  onReviewJob,
  onStartApplicationPrep,
  onSaveJob,
  onDismissJob
}: RecommendationsSectionProps) {
  const totalShown = result.groups.reduce(
    (count, group) => count + group.matches.length,
    0
  );

  if (totalShown === 0) {
    return (
      <section className="rounded-lg border border-line bg-white p-5 shadow-soft">
        <h3 className="text-base font-semibold text-slate-950">
          No matching jobs found yet
        </h3>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          Add a company career page, paste a job URL on the Ingestion page, or
          continue to the dashboard. You can return to onboarding any time.
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-4">
      {result.showsDemoBanner && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          Demo jobs are shown so you can see how matching works. The platform
          will pull real openings from a curated company catalog as soon as
          your resume analysis completes.
        </div>
      )}

      {result.groups.map((group) => (
        <div
          key={group.label}
          className="rounded-lg border border-line bg-white p-5 shadow-soft"
        >
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-base font-semibold text-slate-950">
              {group.label}
            </h3>
            <StatusPill tone={group.label === "Strong matches" ? "good" : "neutral"}>
              {group.matches.length}{" "}
              {group.matches.length === 1 ? "job" : "jobs"}
            </StatusPill>
          </div>
          {group.matches.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500">
              No jobs in this bucket from the current selection.
            </p>
          ) : (
            <ul className="mt-3 space-y-3">
              {group.matches.map(({ match, job, isDemo }) => (
                <RecommendationCard
                  key={job.id}
                  match={match}
                  job={job}
                  isDemo={isDemo}
                  isSaved={savedJobIds.has(job.id)}
                  isDismissed={dismissedJobIds.has(job.id)}
                  onReview={() => onReviewJob(job.id)}
                  onStartPrep={() => onStartApplicationPrep(job.id)}
                  onSave={() => onSaveJob(job.id)}
                  onDismiss={() => onDismissJob(job.id)}
                />
              ))}
            </ul>
          )}
        </div>
      ))}
    </section>
  );
}

interface RecommendationCardProps {
  match: JobMatch;
  job: NormalizedJob;
  isDemo: boolean;
  isSaved: boolean;
  isDismissed: boolean;
  onReview: () => void;
  onStartPrep: () => void;
  onSave: () => void;
  onDismiss: () => void;
}

function RecommendationCard({
  match,
  job,
  isDemo,
  isSaved,
  isDismissed,
  onReview,
  onStartPrep,
  onSave,
  onDismiss
}: RecommendationCardProps) {
  return (
    <li
      className={`rounded-md border ${
        isDismissed ? "border-slate-200 bg-slate-50" : "border-slate-200 bg-panel"
      } p-4`}
    >
      <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-base font-semibold text-slate-950">
              {job.title} — {job.company}
            </p>
            {isDemo && <StatusPill tone="warn">Demo job</StatusPill>}
            {isSaved && <StatusPill tone="good">Saved</StatusPill>}
            {isDismissed && <StatusPill tone="neutral">Dismissed</StatusPill>}
          </div>
          <p className="text-xs text-slate-600">
            {job.location} · {statusLabel(job.remoteType)} · Match{" "}
            <strong>{match.overallScore.toFixed(1)}</strong> / 10
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="inline-flex min-h-9 items-center gap-1 rounded-md border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            onClick={onSave}
            disabled={isSaved}
          >
            <BookmarkPlus aria-hidden="true" size={14} />
            {isSaved ? "Saved" : "Save for later"}
          </button>
          <button
            type="button"
            className="inline-flex min-h-9 items-center gap-1 rounded-md border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            onClick={onDismiss}
            disabled={isDismissed}
          >
            <XCircle aria-hidden="true" size={14} />
            Not interested
          </button>
          <button
            type="button"
            className="inline-flex min-h-9 items-center gap-1 rounded-md border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            onClick={onReview}
          >
            <Eye aria-hidden="true" size={14} />
            Review job
          </button>
          <button
            type="button"
            className="inline-flex min-h-9 items-center gap-1 rounded-md bg-ink px-3 text-xs font-semibold text-white transition hover:bg-slate-700"
            onClick={onStartPrep}
          >
            <Rocket aria-hidden="true" size={14} />
            Start application prep
          </button>
        </div>
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-3">
        <DetailBlock
          icon={CheckCircle2}
          tone="good"
          label="Top match reasons"
          items={match.topMatchReasons.slice(0, 3)}
        />
        <DetailBlock
          icon={FileText}
          tone="warn"
          label="Top gaps"
          items={match.topGaps.slice(0, 3)}
        />
        <DetailBlock
          icon={Sparkles}
          tone="neutral"
          label="Employer is looking for"
          items={match.employerLookingFor.slice(0, 3)}
        />
      </div>

      {match.recommendedNextAction && (
        <p className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs leading-5 text-emerald-900">
          Recommended next action: {match.recommendedNextAction}
        </p>
      )}
    </li>
  );
}

/**
 * Customer-facing quality pill. Intentionally carries no provider
 * or model detail — those live in Admin/System only.
 */
function ResumeQualityBadge({ quality }: { quality: ResumeTextQuality }) {
  const tone =
    quality.status === "good"
      ? "bg-emerald-50 text-emerald-800"
      : quality.status === "partial"
        ? "bg-amber-50 text-amber-900"
        : "bg-red-50 text-red-800";
  return (
    <span
      className={`rounded-md px-2 py-1 text-xs font-semibold ${tone}`}
      data-testid="resume-quality-badge"
    >
      {describeResumeQualityForCustomer(quality)}
    </span>
  );
}

/**
 * Customer-facing analysis-result headline. Replaces the older
 * "Source: OpenAI LLM" / "Source: deterministic fallback" badge so
 * the user sees an outcome (analysis complete, review uncertain
 * fields) rather than implementation detail.
 */
function ResumeAnalysisStatusCallout({
  quality
}: {
  quality: ResumeTextQuality;
}) {
  let headline: string;
  let body: string;
  if (quality.status === "good") {
    headline = "Resume analysis complete";
    body =
      "We extracted the major sections from your resume. Review the details below before applying.";
  } else if (quality.status === "partial") {
    headline = "Review uncertain fields before applying";
    body =
      "Some signals were limited because we could not read the resume fully. Confirm or correct anything that looks off.";
  } else {
    headline = "Limited analysis";
    body =
      "Some fields may be limited because we could not read the resume fully.";
  }
  return (
    <div
      className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700"
      data-testid="resume-analysis-status-callout"
    >
      <p className="font-semibold text-slate-900">{headline}</p>
      <p className="mt-1 leading-5">{body}</p>
    </div>
  );
}

/**
 * Parsing-issue gate. Shown instead of the analyse CTA when the
 * resume text quality is poor / unreadable so we never run the
 * deterministic + LLM pipelines on placeholder PDF text and surface
 * a confidently-wrong analysis. Includes an inline paste textarea
 * so the user can recover without leaving onboarding.
 */
function ResumeParsingIssueCard({
  quality,
  parseDiagnostic,
  onPasteResumeText,
  onNavigateResume
}: {
  quality: ResumeTextQuality;
  /**
   * Server-side parse diagnostic (when available). Overrides the
   * locally-computed quality copy because it carries the
   * specific issueType (e.g. scanned_or_image_pdf) the local
   * pass cannot detect.
   */
  parseDiagnostic: ApiParseDiagnostic | null;
  onPasteResumeText: (text: string) => void;
  onNavigateResume: () => void;
}) {
  const [pasteDraft, setPasteDraft] = useState("");
  const [pasteError, setPasteError] = useState<string | null>(null);

  function handlePaste() {
    const trimmed = pasteDraft.trim();
    if (trimmed.length < 50) {
      setPasteError(
        "Paste at least a few lines of resume text so the analyzer has something to work with."
      );
      return;
    }
    setPasteError(null);
    onPasteResumeText(trimmed);
    setPasteDraft("");
  }

  return (
    <div
      className="mt-4 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900"
      data-testid="resume-parsing-issue-card"
    >
      <div className="flex items-start gap-2">
        <AlertTriangle aria-hidden="true" size={16} className="mt-0.5 shrink-0" />
        <div className="flex-1">
          <p className="font-semibold" data-testid="resume-parsing-issue-headline">
            {parseDiagnostic?.userExplanation ??
              "We couldn't read enough text from this resume."}
          </p>
          {parseDiagnostic ? (
            parseDiagnostic.recommendedFix && (
              <p
                className="mt-1 leading-5"
                data-testid="resume-parsing-issue-fix"
              >
                {parseDiagnostic.recommendedFix}
              </p>
            )
          ) : (
            quality.recommendedFix && (
              <p className="mt-1 leading-5">{quality.recommendedFix}</p>
            )
          )}
          {parseDiagnostic && parseDiagnostic.issueType !== "ok" && (
            <p
              className="mt-2 text-[11px] uppercase tracking-wide text-amber-700"
              data-testid="resume-parsing-issue-cause"
            >
              Likely cause: {parseDiagnostic.likelyCause}
            </p>
          )}
          {!parseDiagnostic && quality.warnings.length > 0 && (
            <ul className="mt-2 space-y-1 text-xs leading-5 text-amber-900">
              {quality.warnings.slice(0, 3).map((line) => (
                <li key={line}>• {line}</li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="mt-3 rounded-md border border-amber-200 bg-white p-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Paste resume text to continue
        </p>
        <textarea
          className="mt-2 min-h-32 w-full rounded-md border border-slate-300 px-3 py-2 text-sm leading-6"
          placeholder="Paste resume text here…"
          value={pasteDraft}
          onChange={(event) => setPasteDraft(event.target.value)}
          data-testid="resume-parsing-issue-paste-input"
        />
        {pasteError && (
          <p className="mt-1 text-xs text-red-700" role="alert">
            {pasteError}
          </p>
        )}
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-ink px-3 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-400"
            data-testid="resume-parsing-issue-paste-submit"
            onClick={handlePaste}
            disabled={pasteDraft.trim().length === 0}
          >
            <Sparkles aria-hidden="true" size={15} />
            Save pasted text and continue
          </button>
          <button
            type="button"
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            onClick={onNavigateResume}
          >
            Upload a different file
          </button>
        </div>
      </div>
    </div>
  );
}

interface ResumeIntelligenceSectionProps {
  resume: Resume | null;
  report: ResumeIntelligenceReport | null;
  recommendation: JobTargetRecommendation | null;
  improvementDraft: ResumeImprovementDraft | null;
  isAnalyzing: boolean;
  isImproving: boolean;
  parseDiagnostic: ApiParseDiagnostic | null;
  aiProbe: ApiAiProbe | null;
  onAnalyzeResume: () => void;
  onPasteResumeText: (text: string) => void;
  onGenerateImprovement: () => void;
  onEditImprovement: (markdown: string) => void;
  onSaveImprovement: () => void;
  onReanalyzeImprovement: () => void;
  onRejectImprovement: () => void;
  onConfirmResumeProfile: () => void;
  onConfirmRecommendedTargets: (selection: {
    selectedRoles: string[];
    selectedIndustries: string[];
    recommendedSeniority: string;
  }) => void;
  onNavigateResume: () => void;
}

function ResumeIntelligenceSection({
  resume,
  report,
  recommendation,
  improvementDraft,
  isAnalyzing,
  isImproving,
  parseDiagnostic,
  aiProbe,
  onAnalyzeResume,
  onPasteResumeText,
  onGenerateImprovement,
  onEditImprovement,
  onSaveImprovement,
  onReanalyzeImprovement,
  onRejectImprovement,
  onConfirmResumeProfile,
  onConfirmRecommendedTargets,
  onNavigateResume
}: ResumeIntelligenceSectionProps) {
  // Compute quality once per render. The quality gate decides
  // whether to show the analyse button, the parsing-issue card,
  // or the report itself — see the JSX below for the branches.
  const quality = useMemo(
    () => (resume ? assessResumeTextQuality(resume) : null),
    [resume]
  );
  const analysisAllowed = quality ? canRunResumeIntelligence(quality) : false;
  const baselineRoles = useMemo(
    () => (recommendation ? selectionFromRecommendation(recommendation).selectedRoles : []),
    [recommendation]
  );
  const [draftRoles, setDraftRoles] = useState<string[]>(baselineRoles);

  useEffect(() => {
    setDraftRoles(baselineRoles);
  }, [baselineRoles]);

  function toggleDraftRole(title: string) {
    setDraftRoles((prev) =>
      prev.includes(title)
        ? prev.filter((item) => item !== title)
        : [...prev, title]
    );
  }

  return (
    <section className="rounded-lg border border-line bg-white p-5 shadow-soft">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-sky-50 text-sky-700">
          <Sparkles aria-hidden="true" size={18} />
        </div>
        <div className="flex-1">
          <h3 className="text-base font-semibold text-slate-950">
            Resume intelligence
          </h3>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            Estimated only. Output is best-effort context, not authoritative
            truth. We never invent experience, skills, or metrics; uncertain
            extraction is marked low confidence.
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            {!resume ? (
              <button
                type="button"
                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 text-sm font-semibold text-amber-900 hover:bg-amber-100"
                onClick={onNavigateResume}
              >
                Upload a resume to start
                <ArrowRight aria-hidden="true" size={15} />
              </button>
            ) : analysisAllowed && !report ? (
              <button
                type="button"
                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-ink px-3 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-400"
                onClick={onAnalyzeResume}
                disabled={isAnalyzing}
              >
                {isAnalyzing ? (
                  <RefreshCw className="animate-spin" aria-hidden="true" size={15} />
                ) : (
                  <Sparkles aria-hidden="true" size={15} />
                )}
                {isAnalyzing ? "Analyzing resume…" : "Analyze resume"}
              </button>
            ) : analysisAllowed && report ? (
              <button
                type="button"
                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400"
                onClick={onAnalyzeResume}
                disabled={isAnalyzing}
              >
                <RefreshCw aria-hidden="true" size={15} />
                {isAnalyzing ? "Refreshing…" : "Refresh analysis"}
              </button>
            ) : null}
            {quality && <ResumeQualityBadge quality={quality} />}
          </div>

          {/* Quality gate: when text quality is poor / unreadable,
              we never run the analysis pipelines — they would
              produce confidently-wrong output (the original bug).
              Instead show a parsing-issue card with an inline
              paste-text option so the user can recover without
              leaving onboarding. */}
          {resume && quality && !analysisAllowed && (
            <ResumeParsingIssueCard
              quality={quality}
              parseDiagnostic={parseDiagnostic}
              onPasteResumeText={onPasteResumeText}
              onNavigateResume={onNavigateResume}
            />
          )}

          {report && analysisAllowed && quality && (
            <ResumeAnalysisStatusCallout quality={quality} />
          )}

          {/* LLM-only customer view: when the analysis fell back to
              the deterministic provider (LLM unreachable, key invalid,
              etc.) we no longer surface keyword-counted "results" as
              if they were real analysis. Instead show an explicit
              unavailable card with a retry button so the user knows
              to retry / fix configuration. The deterministic
              adapter still runs server-side as a test fallback so
              qa:mvp keeps working without an LLM key. */}
          {report &&
            analysisAllowed &&
            report.provider !== "openai" &&
            report.provider !== "azure_openai" && (
              <div
                className="mt-4 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900"
                data-testid="resume-intelligence-llm-unavailable"
              >
                <p className="font-semibold">
                  AI resume analysis is currently unavailable.
                </p>
                <p className="mt-1 leading-5">
                  {aiProbe && !aiProbe.ok && aiProbe.errorCategory
                    ? unavailableCopyForCategory(aiProbe.errorCategory)
                    : aiProbe && aiProbe.ok
                      ? "AI service is back up — the result you're seeing was generated when it was offline. Click Retry analysis to refresh with the live model."
                      : "We couldn't reach the analysis service. Try analysis again in a moment, or pick a different role manually below."}
                </p>
                {aiProbe && !aiProbe.ok && aiProbe.errorDetail && (
                  <p
                    className="mt-2 text-[11px] uppercase tracking-wide text-amber-700"
                    data-testid="resume-intelligence-llm-unavailable-detail"
                  >
                    Probe: {aiProbe.errorCategory ?? "unknown"} · {aiProbe.errorDetail}
                  </p>
                )}
                <button
                  type="button"
                  className="mt-3 inline-flex min-h-9 items-center justify-center gap-2 rounded-md border border-amber-400 bg-white px-3 text-xs font-semibold text-amber-900 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={onAnalyzeResume}
                  disabled={isAnalyzing}
                  data-testid="resume-intelligence-llm-retry"
                >
                  <RefreshCw
                    aria-hidden="true"
                    size={13}
                    className={isAnalyzing ? "animate-spin" : ""}
                  />
                  {isAnalyzing ? "Retrying…" : "Retry analysis"}
                </button>
              </div>
            )}

          {report &&
            analysisAllowed &&
            (report.provider === "openai" ||
              report.provider === "azure_openai") && (
            <div className="mt-5 space-y-4">
              <ExtractedProfileCard
                profile={report.extractedProfile}
                report={report}
                onConfirm={onConfirmResumeProfile}
              />
              <AtsRiskCard report={report} />
              <ResumeImprovementCard
                report={report}
                draft={improvementDraft}
                isImproving={isImproving}
                onGenerate={onGenerateImprovement}
                onEdit={onEditImprovement}
                onSave={onSaveImprovement}
                onReanalyze={onReanalyzeImprovement}
                onReject={onRejectImprovement}
              />
              {recommendation && (
                <JobTargetRecommendationCard
                  recommendation={recommendation}
                  draftRoles={draftRoles}
                  onToggleRole={toggleDraftRole}
                  onConfirm={() =>
                    onConfirmRecommendedTargets({
                      selectedRoles: draftRoles,
                      selectedIndustries: recommendation.recommendedIndustries,
                      recommendedSeniority: recommendation.recommendedSeniority
                    })
                  }
                />
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function ExtractedProfileCard({
  profile,
  report,
  onConfirm
}: {
  profile: ExtractedResumeProfile;
  report: ResumeIntelligenceReport;
  onConfirm: () => void;
}) {
  const rows: { label: string; value: string; key: keyof typeof report.confidenceByField }[] = [
    { label: "Full name", value: profile.fullName, key: "fullName" },
    { label: "Email", value: profile.email, key: "email" },
    { label: "Phone", value: profile.phone, key: "phone" },
    { label: "Location", value: profile.location, key: "location" },
    { label: "LinkedIn", value: profile.linkedinUrl, key: "linkedinUrl" },
    { label: "GitHub", value: profile.githubUrl, key: "githubUrl" },
    { label: "Portfolio", value: profile.portfolioUrl, key: "portfolioUrl" },
    { label: "Current title", value: profile.currentTitle, key: "currentTitle" },
    { label: "Seniority", value: profile.seniorityLevel, key: "seniorityLevel" },
    {
      label: "Years of experience",
      value:
        profile.yearsOfExperience !== null ? String(profile.yearsOfExperience) : "",
      key: "yearsOfExperience"
    }
  ];
  return (
    <div className="rounded-md border border-slate-200 bg-panel p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Extracted candidate profile
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Confidence badges show how sure we are. Uncertain fields stay
            editable.
          </p>
        </div>
        <button
          type="button"
          className="inline-flex min-h-9 items-center gap-2 rounded-md bg-emerald-700 px-3 text-xs font-semibold text-white hover:bg-emerald-800"
          onClick={onConfirm}
        >
          <CheckCircle2 aria-hidden="true" size={14} />
          Apply high-confidence fields to profile
        </button>
      </div>
      <dl className="mt-3 grid gap-2 md:grid-cols-2">
        {rows.map((row) => (
          <div
            key={row.key}
            className="rounded-md border border-slate-200 bg-white p-3"
          >
            <dt className="text-xs uppercase tracking-wide text-slate-500">
              {row.label}
            </dt>
            <dd className="mt-1 flex items-center justify-between gap-2 text-sm text-slate-800">
              <span className="truncate">{row.value || "—"}</span>
              <ConfidenceBadge value={report.confidenceByField[row.key]} />
            </dd>
          </div>
        ))}
      </dl>
      {(profile.skills.length > 0 ||
        profile.industries.length > 0 ||
        profile.quantifiedAchievements.length > 0) && (
        <div className="mt-3 grid gap-2 md:grid-cols-3">
          <ListBlock label="Skills" items={profile.skills} />
          <ListBlock label="Industries" items={profile.industries} />
          <ListBlock
            label="Quantified wins"
            items={profile.quantifiedAchievements}
            limit={8}
          />
        </div>
      )}
      {(report.missingFields.length > 0 || report.ambiguousFields.length > 0) && (
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          {report.missingFields.length > 0 && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs">
              <p className="font-semibold text-amber-900">Missing fields</p>
              <ul className="mt-1 space-y-1 text-amber-800">
                {report.missingFields.map((field) => (
                  <li key={field}>• {field}</li>
                ))}
              </ul>
            </div>
          )}
          {report.ambiguousFields.length > 0 && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs">
              <p className="font-semibold text-amber-900">Ambiguous fields</p>
              <ul className="mt-1 space-y-1 text-amber-800">
                {report.ambiguousFields.map((field) => (
                  <li key={field}>• {field}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AtsRiskCard({ report }: { report: ResumeIntelligenceReport }) {
  const tone = atsToneClasses(report.atsRiskLevel);
  return (
    <div className={`rounded-md border ${tone.border} ${tone.background} p-4`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-start gap-2">
          <ShieldAlert
            aria-hidden="true"
            className={`mt-0.5 ${tone.icon}`}
            size={17}
          />
          <div>
            <p className={`text-sm font-semibold ${tone.title}`}>
              ATS parse risk: {report.atsRiskLevel}
            </p>
            <p className="text-xs text-slate-700">
              Risk score {Math.round(report.atsRiskScore)}/100. Lower is better.
            </p>
          </div>
        </div>
      </div>
      {report.suggestedFixes.length > 0 && (
        <ul className="mt-3 space-y-2">
          {report.suggestedFixes.map((fix) => {
            const fixTone = atsToneClasses(fix.severity);
            return (
              <li
                key={`${fix.field}-${fix.message}`}
                className={`rounded-md border ${fixTone.border} ${fixTone.background} p-3 text-xs`}
              >
                <p className={`font-semibold capitalize ${fixTone.title}`}>
                  {fix.severity} · {fix.field}
                </p>
                <p className="mt-1 text-slate-800">{fix.message}</p>
                {fix.recommendedAction && (
                  <p className="mt-1 text-slate-700">{fix.recommendedAction}</p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

interface ResumeImprovementCardProps {
  report: ResumeIntelligenceReport;
  draft: ResumeImprovementDraft | null;
  isImproving: boolean;
  onGenerate: () => void;
  onEdit: (markdown: string) => void;
  onSave: () => void;
  onReanalyze: () => void;
  onReject: () => void;
}

function ResumeImprovementCard({
  report,
  draft,
  isImproving,
  onGenerate,
  onEdit,
  onSave,
  onReanalyze,
  onReject
}: ResumeImprovementCardProps) {
  const [editingMarkdown, setEditingMarkdown] = useState(
    draft?.draftMarkdown ?? ""
  );
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    setEditingMarkdown(draft?.draftMarkdown ?? "");
    setEditing(false);
  }, [draft?.id, draft?.draftMarkdown]);

  const isFresh = !draft || draft.status === "rejected";
  const canSave =
    draft && (draft.status === "draft" || draft.status === "edited") &&
    !draft.savedAt;
  const canReanalyze =
    draft && draft.status === "saved" && Boolean(draft.improvedResumeId);
  const beforeAfter = draft
    ? {
        original: Math.round(draft.originalRiskScore),
        improved:
          draft.improvedRiskScore !== null
            ? Math.round(draft.improvedRiskScore)
            : null,
        delta:
          draft.improvedRiskScore !== null
            ? Math.round(draft.originalRiskScore - draft.improvedRiskScore)
            : null
      }
    : null;

  return (
    <div className="rounded-md border border-slate-200 bg-panel p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            ATS-friendly improvement
          </p>
          <p className="mt-1 text-sm leading-6 text-slate-700">
            If our parser struggles to read your resume, job boards probably
            do too. Generate a single-column ATS-friendly draft from the
            verified facts we already extracted — no fake metrics, no fake
            skills, original resume preserved.
          </p>
        </div>
        {isFresh && (
          <button
            type="button"
            className="inline-flex min-h-9 items-center justify-center gap-2 rounded-md bg-ink px-3 text-xs font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-400"
            onClick={onGenerate}
            disabled={isImproving}
          >
            {isImproving ? (
              <RefreshCw className="animate-spin" aria-hidden="true" size={13} />
            ) : (
              <Sparkles aria-hidden="true" size={13} />
            )}
            {isImproving ? "Generating…" : "Generate ATS-friendly draft"}
          </button>
        )}
      </div>

      {report.suggestedFixes.length === 0 && !draft && (
        <p className="mt-3 text-xs text-slate-500">
          No ATS warnings detected on this resume — improvement is optional.
        </p>
      )}

      {draft && (
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap gap-2">
            <StatusPill tone="neutral">
              Status {statusLabel(draft.status)}
            </StatusPill>
            {beforeAfter && (
              <StatusPill tone="neutral">
                Original risk {beforeAfter.original}/100
              </StatusPill>
            )}
            {beforeAfter?.improved !== null && beforeAfter && (
              <StatusPill tone={(beforeAfter.delta ?? 0) > 0 ? "good" : "warn"}>
                Improved risk {beforeAfter.improved}/100
                {beforeAfter.delta !== null
                  ? ` · Δ ${beforeAfter.delta >= 0 ? "-" : "+"}${Math.abs(beforeAfter.delta)}`
                  : ""}
              </StatusPill>
            )}
          </div>

          {beforeAfter?.improved !== null &&
            beforeAfter !== null &&
            (beforeAfter.delta ?? 0) <= 0 && (
              <div
                data-testid="improvement-risk-regressed-banner"
                className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900"
              >
                <p className="font-semibold">
                  This draft did not improve ATS risk.
                </p>
                <p className="mt-1 leading-5">
                  Re-analysis shows the improved resume scores at least as
                  high a risk as the original. Review the draft carefully
                  before using it on a real application — your original
                  resume is preserved in version history.
                </p>
              </div>
            )}

          {draft.changesSummary.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Changes summary
              </p>
              <ul className="mt-1 space-y-1 text-xs text-slate-700">
                {draft.changesSummary.map((line) => (
                  <li key={line}>• {line}</li>
                ))}
              </ul>
            </div>
          )}

          {draft.appliedFixes.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
                Applied fixes
              </p>
              <ul className="mt-1 space-y-1 text-xs text-emerald-800">
                {draft.appliedFixes.map((line) => (
                  <li key={line}>✓ {line}</li>
                ))}
              </ul>
            </div>
          )}

          {draft.warningsRemaining.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">
                Remaining warnings
              </p>
              <ul className="mt-1 space-y-1 text-xs text-amber-900">
                {draft.warningsRemaining.map((line) => (
                  <li key={line}>⚠ {line}</li>
                ))}
              </ul>
            </div>
          )}

          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Draft preview
            </p>
            {editing ? (
              <textarea
                className="mt-1 min-h-48 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-xs leading-5"
                value={editingMarkdown}
                onChange={(e) => setEditingMarkdown(e.target.value)}
              />
            ) : (
              <pre className="mt-1 max-h-72 overflow-auto rounded-md border border-slate-200 bg-white p-3 font-mono text-xs leading-5 text-slate-800 whitespace-pre-wrap">
                {draft.draftMarkdown}
              </pre>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            {!editing && draft.status !== "saved" && draft.status !== "rejected" && (
              <button
                type="button"
                className="inline-flex min-h-9 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                onClick={() => setEditing(true)}
              >
                Edit draft
              </button>
            )}
            {editing && (
              <>
                <button
                  type="button"
                  className="inline-flex min-h-9 items-center gap-2 rounded-md bg-ink px-3 text-xs font-semibold text-white hover:bg-slate-700"
                  onClick={() => {
                    onEdit(editingMarkdown);
                    setEditing(false);
                  }}
                >
                  Save draft edit
                </button>
                <button
                  type="button"
                  className="inline-flex min-h-9 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  onClick={() => {
                    setEditingMarkdown(draft.draftMarkdown);
                    setEditing(false);
                  }}
                >
                  Cancel
                </button>
              </>
            )}
            {canSave && !editing && (
              <button
                type="button"
                className="inline-flex min-h-9 items-center gap-2 rounded-md bg-emerald-700 px-3 text-xs font-semibold text-white hover:bg-emerald-800"
                onClick={onSave}
              >
                <CheckCircle2 aria-hidden="true" size={13} />
                Save as new resume version
              </button>
            )}
            {canReanalyze && (
              <button
                type="button"
                className="inline-flex min-h-9 items-center gap-2 rounded-md bg-ink px-3 text-xs font-semibold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-400"
                onClick={onReanalyze}
                disabled={isImproving}
              >
                <RefreshCw aria-hidden="true" size={13} />
                Re-run analysis
              </button>
            )}
            {draft.status !== "saved" && draft.status !== "rejected" && !editing && (
              <button
                type="button"
                className="inline-flex min-h-9 items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 text-xs font-semibold text-red-700 hover:bg-red-100"
                onClick={onReject}
              >
                Reject draft
              </button>
            )}
            {draft.status === "saved" && (
              <button
                type="button"
                className="inline-flex min-h-9 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                onClick={onGenerate}
                disabled={isImproving}
              >
                Generate a new draft
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function JobTargetRecommendationCard({
  recommendation,
  draftRoles,
  onToggleRole,
  onConfirm
}: {
  recommendation: JobTargetRecommendation;
  draftRoles: string[];
  onToggleRole: (title: string) => void;
  onConfirm: () => void;
}) {
  return (
    <div className="rounded-md border border-slate-200 bg-panel p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Recommended job targets
          </p>
          <p className="mt-1 text-sm leading-6 text-slate-700">
            {recommendation.positioningSummary}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Confidence: {recommendation.confidence}
          </p>
        </div>
        <button
          type="button"
          className="inline-flex min-h-9 items-center gap-2 rounded-md bg-emerald-700 px-3 text-xs font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-slate-400"
          onClick={onConfirm}
          disabled={draftRoles.length === 0}
        >
          <Target aria-hidden="true" size={14} />
          Confirm targets ({draftRoles.length})
        </button>
      </div>

      <RoleGroup
        label="Strongest fit"
        roles={recommendation.strongestRoles}
        draftRoles={draftRoles}
        onToggle={onToggleRole}
        tone="good"
      />
      <RoleGroup
        label="Adjacent"
        roles={recommendation.adjacentRoles}
        draftRoles={draftRoles}
        onToggle={onToggleRole}
        tone="neutral"
      />
      <RoleGroup
        label="Stretch"
        roles={recommendation.stretchRoles}
        draftRoles={draftRoles}
        onToggle={onToggleRole}
        tone="warn"
      />
      {recommendation.rolesToAvoid.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Roles to avoid
          </p>
          <ul className="mt-2 space-y-1 text-xs text-slate-700">
            {recommendation.rolesToAvoid.map((role) => (
              <li key={role.title}>
                <strong>{role.title}</strong> — {role.why}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <ListBlock
          label="Recommended industries"
          items={recommendation.recommendedIndustries}
        />
        <ListBlock
          label="Search keywords"
          items={recommendation.recommendedSearchKeywords}
        />
        <ListBlock
          label="Positioning advice"
          items={recommendation.resumePositioningAdvice}
        />
      </div>
      {recommendation.skillGaps.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Skill gaps
          </p>
          <ul className="mt-2 space-y-2">
            {recommendation.skillGaps.map((gap) => (
              <li
                key={`${gap.skill}-${gap.importance}`}
                className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900"
              >
                <p className="font-semibold capitalize">
                  {gap.skill} ({gap.importance})
                </p>
                <p className="mt-1">{gap.reason}</p>
                <p className="mt-1">{gap.howToClose}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function RoleGroup({
  label,
  roles,
  draftRoles,
  onToggle,
  tone
}: {
  label: string;
  roles: RecommendedRole[];
  draftRoles: string[];
  onToggle: (title: string) => void;
  tone: "good" | "warn" | "neutral";
}) {
  if (roles.length === 0) return null;
  return (
    <div className="mt-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label} ({roles.length})
      </p>
      <ul className="mt-2 space-y-2">
        {roles.map((role) => {
          const checked = draftRoles.includes(role.title);
          const stretchLabel = role.fitLevel === "stretch" ? "Stretch · " : "";
          return (
            <li
              key={`${role.title}-${role.fitLevel}`}
              className="rounded-md border border-slate-200 bg-white p-3"
            >
              <label className="flex items-start gap-3 text-sm text-slate-800">
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4 rounded border-slate-300"
                  checked={checked}
                  onChange={() => onToggle(role.title)}
                />
                <span className="flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <strong>{stretchLabel}{role.title}</strong>
                    <ConfidenceBadge value={role.confidence} />
                    <StatusPill tone={tone}>{role.fitLevel}</StatusPill>
                  </span>
                  <span className="mt-1 block text-xs text-slate-600">
                    {role.why}
                  </span>
                  {role.evidenceFromResume.length > 0 && (
                    <span className="mt-1 block text-xs text-slate-500">
                      Evidence: {role.evidenceFromResume.join("; ")}
                    </span>
                  )}
                  {role.searchKeywords.length > 0 && (
                    <span className="mt-1 block text-xs text-slate-500">
                      Search keywords: {role.searchKeywords.join(", ")}
                    </span>
                  )}
                  {role.suggestedResumeAngle && (
                    <span className="mt-1 block text-xs text-emerald-800">
                      Resume angle: {role.suggestedResumeAngle}
                    </span>
                  )}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ListBlock({
  label,
  items,
  limit
}: {
  label: string;
  items: string[];
  /**
   * Optional cap so very long lists (e.g. 40-bullet "Quantified
   * wins" extracted from a 20-year senior resume) don't dominate
   * the entire panel. Caller can omit when display length is
   * already bounded.
   */
  limit?: number;
}) {
  // Strip any leading bullet markers from the source string so the UI's
  // own "•" glyph doesn't double up into "• -" / "• •".
  const cleaned = items
    .map((item) => item.replace(/^[\s]*[-*•·●◦▪▫–—]+[\s]+/, "").trim())
    .filter((item) => item.length > 0);
  if (cleaned.length === 0) return null;
  const displayed =
    typeof limit === "number" && cleaned.length > limit
      ? cleaned.slice(0, limit)
      : cleaned;
  const overflow = cleaned.length - displayed.length;
  return (
    <div className="rounded-md border border-slate-200 bg-white p-3 text-xs">
      <p className="font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <ul className="mt-1 space-y-1 text-slate-700">
        {displayed.map((item) => (
          <li key={item}>• {item}</li>
        ))}
      </ul>
      {overflow > 0 && (
        <p className="mt-2 text-[11px] text-slate-500">
          + {overflow} more — full list available in the resume preview.
        </p>
      )}
    </div>
  );
}

// NOTE: previous customer-facing widgets `ResumeIntelligenceModeBadge`
// and `ResumeIntelligenceModeCallout` (which exposed provider /
// model / prompt detail) have been replaced by `ResumeQualityBadge`
// and `ResumeAnalysisStatusCallout`. Provider details now live in
// Admin/System AI Diagnostics only — see docs/AI_SERVICE_ARCHITECTURE.md.

function ConfidenceBadge({ value }: { value: ResumeFieldConfidence }) {
  const tone =
    value === "high"
      ? "bg-emerald-50 text-emerald-700"
      : value === "medium"
        ? "bg-amber-50 text-amber-700"
        : "bg-slate-100 text-slate-700";
  return (
    <span
      className={`shrink-0 rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${tone}`}
    >
      {value}
    </span>
  );
}

function atsToneClasses(level: AtsRiskLevel): {
  border: string;
  background: string;
  icon: string;
  title: string;
} {
  if (level === "high") {
    return {
      border: "border-red-200",
      background: "bg-red-50",
      icon: "text-red-700",
      title: "text-red-900"
    };
  }
  if (level === "medium") {
    return {
      border: "border-amber-200",
      background: "bg-amber-50",
      icon: "text-amber-700",
      title: "text-amber-900"
    };
  }
  return {
    border: "border-emerald-200",
    background: "bg-emerald-50",
    icon: "text-emerald-700",
    title: "text-emerald-900"
  };
}

function DetailBlock({
  icon: Icon,
  tone,
  label,
  items
}: {
  icon: typeof CheckCircle2;
  tone: "good" | "warn" | "neutral";
  label: string;
  items: string[];
}) {
  const palette =
    tone === "good"
      ? "text-emerald-700"
      : tone === "warn"
        ? "text-amber-700"
        : "text-slate-700";
  return (
    <div className="rounded-md border border-slate-200 bg-white p-3">
      <p className={`flex items-center gap-2 text-xs font-semibold uppercase tracking-wide ${palette}`}>
        <Icon aria-hidden="true" size={14} />
        {label}
      </p>
      {items.length === 0 ? (
        <p className="mt-1 text-xs text-slate-500">No items.</p>
      ) : (
        <ul className="mt-1 space-y-1 text-xs leading-5 text-slate-700">
          {items.map((item) => (
            <li key={item}>• {item}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
