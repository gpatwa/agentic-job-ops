import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  BookmarkPlus,
  CheckCircle2,
  Eye,
  FileText,
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
  ResumeIntelligenceReport,
  UserProfile
} from "../models/domain";
import type { OnboardingRecommendationResult } from "../services/onboardingJobRecommendationService";
import { isDemoJob } from "../services/onboardingJobRecommendationService";
import { selectionFromRecommendation } from "../services/resumeIntelligenceService";

interface OnboardingPageProps {
  profile: UserProfile | null;
  resume: Resume | null;
  state: OnboardingState;
  applications: ApplicationRecord[];
  isRecommending: boolean;
  lastResult: OnboardingRecommendationResult | null;
  resumeIntelligenceReport: ResumeIntelligenceReport | null;
  jobTargetRecommendation: JobTargetRecommendation | null;
  isAnalyzingResume: boolean;
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
  isAnalyzingResume,
  onAnalyzeResume,
  onConfirmResumeProfile,
  onConfirmRecommendedTargets,
  onSelectRoles,
  onGenerateRecommendations,
  onReviewJob,
  onStartApplicationPrep,
  onSaveJob,
  onDismissJob,
  onCompleteOnboarding,
  onNavigateProfile,
  onNavigateResume,
  onNavigateDashboard,
  onNavigateJobQueue
}: OnboardingPageProps) {
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

  const allSuggestedAndProfile = useMemo(() => {
    const set = new Set<string>([...profileTargetTitles, ...SUGGESTED_ROLES]);
    return Array.from(set);
  }, [profileTargetTitles]);

  const onboardingComplete = Boolean(state.onboardingCompletedAt);

  return (
    <div className="space-y-6">
      <header className="max-w-3xl">
        <p className="text-sm font-semibold uppercase tracking-wide text-emerald-700">
          Onboarding
        </p>
        <h2 className="mt-2 text-3xl font-semibold text-slate-950">
          Get to your first apply-ready job
        </h2>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          Confirm a couple of target roles and we'll show jobs you can act on
          right away. Demo jobs are clearly labeled when no real jobs are
          ingested yet. The assistant never submits an application during
          onboarding.
        </p>
      </header>

      <section className="grid gap-4 md:grid-cols-3">
        <ReadinessCard
          title="Resume"
          status={resume ? "Uploaded" : "Not uploaded"}
          tone={resume ? "good" : "warn"}
          actionLabel={resume ? "Manage resume" : "Upload resume"}
          onAction={onNavigateResume}
        />
        <ReadinessCard
          title="Profile"
          status={profile?.fullName ? "Saved" : "Not saved"}
          tone={profile?.fullName ? "good" : "warn"}
          actionLabel="Edit profile"
          onAction={onNavigateProfile}
        />
        <ReadinessCard
          title="Onboarding"
          status={
            onboardingComplete
              ? "Completed"
              : state.firstApplyReadyJobsShown
                ? "Recommendations ready"
                : "In progress"
          }
          tone={onboardingComplete ? "good" : "neutral"}
          actionLabel="Go to dashboard"
          onAction={() => {
            onCompleteOnboarding("user_chose_dashboard");
            onNavigateDashboard();
          }}
        />
      </section>

      <ResumeIntelligenceSection
        resume={resume}
        report={resumeIntelligenceReport}
        recommendation={jobTargetRecommendation}
        isAnalyzing={isAnalyzingResume}
        onAnalyzeResume={onAnalyzeResume}
        onConfirmResumeProfile={onConfirmResumeProfile}
        onConfirmRecommendedTargets={(selection) => {
          onConfirmRecommendedTargets(selection);
          setSelectedRoles(selection.selectedRoles);
        }}
        onNavigateResume={onNavigateResume}
      />

      <section className="rounded-lg border border-line bg-white p-5 shadow-soft">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-emerald-50 text-emerald-700">
            <Target aria-hidden="true" size={18} />
          </div>
          <div className="flex-1">
            <h3 className="text-base font-semibold text-slate-950">
              Choose your target roles
            </h3>
            <p className="mt-1 text-sm leading-6 text-slate-600">
              Pick one or more roles you'd be excited to apply for. Saved
              profile target titles appear first; you can also add your own.
            </p>

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
                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400"
                onClick={handleSaveSelection}
                disabled={selectedRoles.length === 0}
              >
                Save selection
              </button>
              <button
                type="button"
                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-ink px-3 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-400"
                onClick={handleGenerate}
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

      {lastResult && (
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

      {!lastResult && state.firstApplyReadyJobsShown && (
        <section className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          Recommendations were already shown earlier. Generate again to refresh
          the list.
        </section>
      )}

      {state.firstApplyReadyJobsShown && (
        <footer className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-white p-4 shadow-soft">
          <span className="text-sm text-slate-600">
            Done for now? You can come back to onboarding any time from the
            sidebar.
          </span>
          <button
            type="button"
            className="ml-auto inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            onClick={() => {
              onCompleteOnboarding("user_chose_dashboard");
              onNavigateDashboard();
            }}
          >
            Go to dashboard
            <ArrowRight aria-hidden="true" size={16} />
          </button>
        </footer>
      )}
    </div>
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
          Demo jobs are shown so you can see how matching works. Add a real
          source on the Ingestion page when you're ready.
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

interface ResumeIntelligenceSectionProps {
  resume: Resume | null;
  report: ResumeIntelligenceReport | null;
  recommendation: JobTargetRecommendation | null;
  isAnalyzing: boolean;
  onAnalyzeResume: () => void;
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
  isAnalyzing,
  onAnalyzeResume,
  onConfirmResumeProfile,
  onConfirmRecommendedTargets,
  onNavigateResume
}: ResumeIntelligenceSectionProps) {
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

          <div className="mt-4 flex flex-wrap gap-2">
            {!resume ? (
              <button
                type="button"
                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 text-sm font-semibold text-amber-900 hover:bg-amber-100"
                onClick={onNavigateResume}
              >
                Upload a resume to start
                <ArrowRight aria-hidden="true" size={15} />
              </button>
            ) : !report ? (
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
            ) : (
              <button
                type="button"
                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400"
                onClick={onAnalyzeResume}
                disabled={isAnalyzing}
              >
                <RefreshCw aria-hidden="true" size={15} />
                {isAnalyzing ? "Refreshing…" : "Refresh analysis"}
              </button>
            )}
            <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">
              Adapter:{" "}
              {report
                ? statusLabel(report.extractionMode)
                : "deterministic fallback"}
            </span>
          </div>

          {report && (
            <div className="mt-5 space-y-4">
              <ExtractedProfileCard
                profile={report.extractedProfile}
                report={report}
                onConfirm={onConfirmResumeProfile}
              />
              <AtsRiskCard report={report} />
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
          <ListBlock label="Quantified wins" items={profile.quantifiedAchievements} />
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
            Confidence: {recommendation.confidence} · Adapter:{" "}
            {statusLabel(recommendation.extractionMode)}
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

function ListBlock({ label, items }: { label: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="rounded-md border border-slate-200 bg-white p-3 text-xs">
      <p className="font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <ul className="mt-1 space-y-1 text-slate-700">
        {items.map((item) => (
          <li key={item}>• {item}</li>
        ))}
      </ul>
    </div>
  );
}

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
