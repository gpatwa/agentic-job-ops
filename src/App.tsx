import {
  BarChart3,
  BriefcaseBusiness,
  CalendarClock,
  ClipboardList,
  DatabaseZap,
  FileUp,
  LayoutDashboard,
  Plug,
  Rocket,
  UserCog,
  UserRound
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { AppShell, type NavigationItem } from "./components/AppShell";
import { currentSession } from "./data/currentSession";
import type {
  AIOutputMetadata,
  ApplicationAnswer,
  ApplicationOutcome,
  BrowserApplicationSession,
  ApplicationPackage,
  ApplicationRecord,
  ApplicationStatus,
  AuditLog,
  CareerOpsRun,
  CareerOpsScheduleMode,
  CareerOpsSettings,
  CompanyIntelligence,
  DashboardJobAction,
  EvalCase,
  EvalResult,
  EvalRun,
  EventMetadata,
  ExtensionPageStructure,
  ExtensionSession,
  FeedbackEvent,
  JobMatch,
  JobRiskSignal,
  JobTargetRecommendation,
  OnboardingState,
  RealSiteDryRunSnapshot,
  RecruiterLead,
  Resume,
  ResumeIntelligenceReport,
  UsageMeteringEvent,
  UserProfile
} from "./models/domain";
import { AdminSystemPage } from "./pages/AdminSystemPage";
import { ApplicationPackagePage } from "./pages/ApplicationPackagePage";
import { ApplicationTrackerPage } from "./pages/ApplicationTrackerPage";
import { BrowserSessionReviewPage } from "./pages/BrowserSessionReviewPage";
import { CareerOpsPage } from "./pages/CareerOpsPage";
import { CareerProfilePage } from "./pages/CareerProfilePage";
import { DashboardHome } from "./pages/DashboardHome";
import { ExtensionSetupPage } from "./pages/ExtensionSetupPage";
import { IngestionAdminPage } from "./pages/IngestionAdminPage";
import { JobDashboardPage } from "./pages/JobDashboardPage";
import { OnboardingPage } from "./pages/OnboardingPage";
import { ProfileSetupPage } from "./pages/ProfileSetupPage";
import { ResumeUploadPage } from "./pages/ResumeUploadPage";
import { calculateProfileCompletion } from "./lib/profileCompletion";
import { clearScopedWorkspace } from "./lib/storage";
import { appendAuditLog, loadAuditLogs } from "./services/auditLog";
import {
  approveApplicationPackage,
  generateApplicationPackage,
  loadApplicationAnswers,
  loadApplicationPackages,
  rejectApplicationPackage,
  updateApplicationAnswerDraft,
  updateApplicationPackageDraft,
  type ApplicationPackageContext
} from "./services/applicationPackage";
import { loadApplications } from "./services/applicationService";
import {
  applyDashboardJobAction,
  changeApplicationNotes,
  changeApplicationStatus
} from "./services/applicationWorkflow";
import {
  importManualJobUrl,
  loadJobSourceConfigs,
  loadNormalizedJobs,
  loadScanRuns,
  runManualScan,
  upsertJobSourceConfig,
  type JobSourceConfigDraft
} from "./services/jobIngestion";
import { loadJobMatches, scoreJobsForProfile } from "./services/matchEngine";
import {
  loadUserProfile,
  saveUserProfile,
  type UserProfileDraft
} from "./services/profileService";
import { createResumeUpload, loadResume, saveResume } from "./services/resumeService";
import {
  loadAIOutputMetadata,
  recordAIOutputMetadata
} from "./services/aiOutputMetadata";
import {
  loadApplicationOutcomes,
  outcomeForApplicationStatus,
  recordApplicationOutcome
} from "./services/applicationOutcomeService";
import {
  approveBrowserSubmit,
  loadBrowserApplicationSessions,
  markBrowserSessionManualRequired,
  markBrowserSessionReadyForReview,
  startBrowserApplicationSession,
  submitApprovedBrowserApplication,
  type BrowserApplicationResult
} from "./services/browserApplicationAssistant";
import {
  loadEvalCases,
  loadEvalResults,
  loadEvalRuns,
  runEvalSuite
} from "./services/evalService";
import { appendFeedbackEvent, loadFeedbackEvents } from "./services/feedbackService";
import {
  appendUsageMeteringEvent,
  loadUsageMeteringEvents
} from "./services/usageMetering";
import {
  approveExtensionFill,
  approveExtensionSubmit,
  authorizeExtensionSession,
  createExtensionFillPlan,
  createExtensionSession,
  disconnectExtensionSession,
  ingestExtensionPageStructure,
  loadExtensionSessions,
  markExtensionManualRequired,
  recordExtensionFieldsFilled,
  recordExtensionSubmitCompleted,
  type ExtensionAuditEvent,
  type ExtensionResult
} from "./services/extensionService";
import {
  createDryRunSnapshot,
  loadDryRunSnapshots,
  recordSnapshotExport,
  type RealSiteAuditEvent,
  type RealSiteDryRunComparison
} from "./services/realSiteDryRunService";
import {
  loadCareerOpsRuns,
  loadCareerOpsSettings,
  runCareerOps,
  saveCareerOpsSettings,
  type CareerOpsAuditEvent,
  type CareerOpsRunResult
} from "./services/careerOpsService";
import {
  generateCompanyIntelligence,
  intelligenceForJob,
  loadCompanyIntelligence,
  loadJobRiskSignals,
  loadRecruiterLeads,
  saveJobRiskSignals,
  type IntelligenceAuditEvent
} from "./services/intelligenceService";
import {
  loadOnboardingState,
  recommendApplyReadyJobs,
  recordOnboardingApplicationPrepStarted,
  recordOnboardingCompleted,
  recordOnboardingJobReviewed,
  recordTargetRolesSelected,
  type OnboardingAuditEvent,
  type OnboardingRecommendationResult
} from "./services/onboardingJobRecommendationService";
import {
  analyzeResumeIntelligence,
  getJobTargetRecommendation,
  getResumeIntelligenceReport,
  loadJobTargetRecommendations,
  loadResumeIntelligenceReports,
  recordRecommendationsConfirmed,
  recordResumeProfileConfirmed,
  selectionFromRecommendation,
  type ResumeIntelligenceAuditEvent
} from "./services/resumeIntelligenceService";

type RouteId =
  | "dashboard"
  | "onboarding"
  | "profile-setup"
  | "resume-upload"
  | "career-profile"
  | "ingestion"
  | "jobs"
  | "tracker"
  | "admin"
  | "extension-setup"
  | "career-ops"
  | "package-review"
  | "browser-session";

const navigationItems: NavigationItem<RouteId>[] = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "onboarding", label: "Onboarding", icon: Rocket },
  { id: "profile-setup", label: "Profile setup", icon: UserRound },
  { id: "resume-upload", label: "Resume upload", icon: FileUp },
  { id: "career-profile", label: "Career profile", icon: UserCog },
  { id: "ingestion", label: "Ingestion", icon: DatabaseZap },
  { id: "jobs", label: "Job queues", icon: BriefcaseBusiness },
  { id: "tracker", label: "Tracker", icon: ClipboardList },
  { id: "career-ops", label: "Career Ops", icon: CalendarClock },
  { id: "extension-setup", label: "Extension setup", icon: Plug },
  { id: "admin", label: "Admin", icon: BarChart3 }
];

const routeIds = navigationItems.map((item) => item.id);
const isDevelopment = import.meta.env.DEV;

function routeFromHash(): RouteId {
  const route = window.location.hash.replace("#", "");
  if (route.startsWith("package-review:")) {
    return "package-review";
  }

  if (route.startsWith("browser-session:")) {
    return "browser-session";
  }

  return routeIds.includes(route as RouteId) ? (route as RouteId) : "dashboard";
}

function packageIdFromHash(): string | null {
  const route = window.location.hash.replace("#", "");
  if (!route.startsWith("package-review:")) {
    return null;
  }

  return route.replace("package-review:", "") || null;
}

function browserSessionIdFromHash(): string | null {
  const route = window.location.hash.replace("#", "");
  if (!route.startsWith("browser-session:")) {
    return null;
  }

  return route.replace("browser-session:", "") || null;
}

function extensionFor(fileName: string): string {
  const pieces = fileName.split(".");
  return pieces.length > 1 ? pieces[pieces.length - 1].toLowerCase() : "unknown";
}

export default function App() {
  const [route, setRoute] = useState<RouteId>(() => routeFromHash());
  const [profile, setProfile] = useState<UserProfile | null>(() =>
    loadUserProfile(currentSession)
  );
  const [resume, setResume] = useState<Resume | null>(() => loadResume(currentSession));
  const [applications, setApplications] = useState<ApplicationRecord[]>(() =>
    loadApplications(currentSession)
  );
  const [applicationPackages, setApplicationPackages] = useState<ApplicationPackage[]>(
    () => loadApplicationPackages(currentSession)
  );
  const [applicationAnswers, setApplicationAnswers] = useState<ApplicationAnswer[]>(
    () => loadApplicationAnswers(currentSession)
  );
  const [selectedPackageId, setSelectedPackageId] = useState<string | null>(() =>
    packageIdFromHash()
  );
  const [selectedBrowserSessionId, setSelectedBrowserSessionId] = useState<
    string | null
  >(() => browserSessionIdFromHash());
  const [browserSessions, setBrowserSessions] = useState<
    BrowserApplicationSession[]
  >(() => loadBrowserApplicationSessions(currentSession));
  const [extensionSessions, setExtensionSessions] = useState<ExtensionSession[]>(
    () => loadExtensionSessions(currentSession)
  );
  const [realSiteSnapshots, setRealSiteSnapshots] = useState<RealSiteDryRunSnapshot[]>(
    () => loadDryRunSnapshots(currentSession)
  );
  const [careerOpsSettings, setCareerOpsSettings] = useState<CareerOpsSettings>(
    () => loadCareerOpsSettings(currentSession)
  );
  const [careerOpsRuns, setCareerOpsRuns] = useState<CareerOpsRun[]>(() =>
    loadCareerOpsRuns(currentSession)
  );
  const [isCareerOpsRunning, setIsCareerOpsRunning] = useState(false);
  const [companyIntelligence, setCompanyIntelligence] = useState<CompanyIntelligence[]>(
    () => loadCompanyIntelligence(currentSession)
  );
  const [jobRiskSignals, setJobRiskSignals] = useState<JobRiskSignal[]>(
    () => loadJobRiskSignals(currentSession)
  );
  const [recruiterLeads, setRecruiterLeads] = useState<RecruiterLead[]>(
    () => loadRecruiterLeads(currentSession)
  );
  const [isGeneratingIntelligence, setIsGeneratingIntelligence] = useState(false);
  const [onboardingState, setOnboardingState] = useState<OnboardingState>(() =>
    loadOnboardingState(currentSession)
  );
  const [isOnboardingRecommending, setIsOnboardingRecommending] = useState(false);
  const [onboardingResult, setOnboardingResult] =
    useState<OnboardingRecommendationResult | null>(null);
  const [resumeIntelligenceReports, setResumeIntelligenceReports] = useState<
    ResumeIntelligenceReport[]
  >(() => loadResumeIntelligenceReports(currentSession));
  const [jobTargetRecommendations, setJobTargetRecommendations] = useState<
    JobTargetRecommendation[]
  >(() => loadJobTargetRecommendations(currentSession));
  const [isAnalyzingResume, setIsAnalyzingResume] = useState(false);
  const [jobSourceConfigs, setJobSourceConfigs] = useState(() =>
    loadJobSourceConfigs(currentSession)
  );
  const [normalizedJobs, setNormalizedJobs] = useState(() =>
    loadNormalizedJobs(currentSession)
  );
  const [jobMatches, setJobMatches] = useState<JobMatch[]>(() =>
    loadJobMatches(currentSession)
  );
  const [scanRuns, setScanRuns] = useState(() => loadScanRuns(currentSession));
  const [isScanning, setIsScanning] = useState(false);
  const [isScoring, setIsScoring] = useState(false);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>(() =>
    loadAuditLogs(currentSession)
  );
  const [feedbackEvents, setFeedbackEvents] = useState<FeedbackEvent[]>(() =>
    loadFeedbackEvents(currentSession)
  );
  const [usageEvents, setUsageEvents] = useState<UsageMeteringEvent[]>(() =>
    loadUsageMeteringEvents(currentSession)
  );
  const [evalCases, setEvalCases] = useState<EvalCase[]>(() =>
    loadEvalCases(currentSession)
  );
  const [evalRuns, setEvalRuns] = useState<EvalRun[]>(() =>
    loadEvalRuns(currentSession)
  );
  const [evalResults, setEvalResults] = useState<EvalResult[]>(() =>
    loadEvalResults(currentSession)
  );
  const [applicationOutcomes, setApplicationOutcomes] = useState<
    ApplicationOutcome[]
  >(() => loadApplicationOutcomes(currentSession));
  const [aiOutputMetadata, setAIOutputMetadata] = useState<AIOutputMetadata[]>(
    () => loadAIOutputMetadata(currentSession)
  );
  const [isRunningEvals, setIsRunningEvals] = useState(false);

  useEffect(() => {
    const handleHashChange = () => {
      setRoute(routeFromHash());
      setSelectedPackageId(packageIdFromHash());
      setSelectedBrowserSessionId(browserSessionIdFromHash());
    };
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  const completion = useMemo(() => calculateProfileCompletion(profile), [profile]);

  function navigate(nextRoute: RouteId) {
    window.location.hash = nextRoute;
    setRoute(nextRoute);
  }

  function navigateToPackage(packageId: string) {
    window.location.hash = `package-review:${packageId}`;
    setSelectedPackageId(packageId);
    setRoute("package-review");
  }

  function navigateToBrowserSession(sessionId: string) {
    window.location.hash = `browser-session:${sessionId}`;
    setSelectedBrowserSessionId(sessionId);
    setRoute("browser-session");
  }

  function recordAudit(log: Parameters<typeof appendAuditLog>[1]) {
    const savedLog = appendAuditLog(currentSession, log);
    setAuditLogs((current) => [savedLog, ...current].slice(0, 50));
  }

  function recordFeedback(input: Parameters<typeof appendFeedbackEvent>[1]) {
    const event = appendFeedbackEvent(currentSession, input);
    setFeedbackEvents((current) => [event, ...current].slice(0, 500));
  }

  function recordUsage(input: Parameters<typeof appendUsageMeteringEvent>[1]) {
    const event = appendUsageMeteringEvent(currentSession, input);
    setUsageEvents((current) => [event, ...current].slice(0, 1000));
  }

  function recordAIOutput(input: Parameters<typeof recordAIOutputMetadata>[1]) {
    const metadata = recordAIOutputMetadata(currentSession, input);
    setAIOutputMetadata((current) => [metadata, ...current].slice(0, 1000));
  }

  function recordOutcomeForApplication(
    application: ApplicationRecord,
    notes = ""
  ) {
    const outcome = outcomeForApplicationStatus(application.status);
    if (!outcome) {
      return;
    }

    const savedOutcome = recordApplicationOutcome(
      currentSession,
      application,
      outcome,
      notes
    );
    setApplicationOutcomes(loadApplicationOutcomes(currentSession));

    if (outcome === "recruiter_response") {
      recordFeedback({
        eventType: "recruiter_response_received",
        resourceType: "ApplicationOutcome",
        resourceId: savedOutcome.id,
        metadata: { applicationRecordId: application.id, jobId: application.jobId }
      });
    } else if (outcome === "interview_scheduled") {
      recordFeedback({
        eventType: "interview_scheduled",
        resourceType: "ApplicationOutcome",
        resourceId: savedOutcome.id,
        metadata: { applicationRecordId: application.id, jobId: application.jobId }
      });
    } else if (outcome === "rejected") {
      recordFeedback({
        eventType: "rejected",
        resourceType: "ApplicationOutcome",
        resourceId: savedOutcome.id,
        metadata: { applicationRecordId: application.id, jobId: application.jobId }
      });
    } else if (outcome === "offer") {
      recordFeedback({
        eventType: "offer_received",
        resourceType: "ApplicationOutcome",
        resourceId: savedOutcome.id,
        metadata: { applicationRecordId: application.id, jobId: application.jobId }
      });
    }
  }

  function recordBrowserResult(result: BrowserApplicationResult) {
    setBrowserSessions(result.sessions);
    setApplications(result.applications);
    result.auditEvents.forEach((event) => {
      recordAudit({
        action: event.action,
        resourceType: event.resourceType,
        resourceId: event.resourceId,
        metadata: event.metadata
      });
      if (event.action === "browser_session_created") {
        recordFeedback({
          eventType: "browser_session_created",
          resourceType: event.resourceType,
          resourceId: event.resourceId,
          metadata: event.metadata
        });
        recordUsage({
          eventType: "browser_session_started",
          resourceType: event.resourceType,
          resourceId: event.resourceId,
          metadata: event.metadata
        });
      } else if (event.action === "user_approved_browser_submit") {
        recordFeedback({
          eventType: "browser_submit_approved",
          resourceType: event.resourceType,
          resourceId: event.resourceId,
          metadata: event.metadata
        });
        recordUsage({
          eventType: "browser_submit_approved",
          resourceType: event.resourceType,
          resourceId: event.resourceId,
          metadata: event.metadata
        });
      } else if (event.action === "application_submitted") {
        recordFeedback({
          eventType: "application_submitted",
          resourceType: event.resourceType,
          resourceId: event.resourceId,
          metadata: event.metadata
        });
        recordUsage({
          eventType: "application_submitted",
          resourceType: event.resourceType,
          resourceId: event.resourceId,
          metadata: event.metadata
        });
        recordOutcomeForApplication(result.application);
      } else if (event.action === "form_fields_detected") {
        recordAIOutput({
          outputType: "browser_field_mapping",
          resourceType: event.resourceType,
          resourceId: event.resourceId,
          modelName: result.session.adapterName || "ats-adapter-orchestrator",
          promptVersion: "ats-fill-plan-v1",
          provider: "local",
          mode: "deterministic",
          inputHash: String(event.metadata.applicationPackageId ?? "not_recorded"),
          outputHash: String(event.metadata.fieldCount ?? 0)
        });
      } else if (event.action === "ats_adapter_run_completed") {
        recordFeedback({
          eventType: "ats_adapter_run",
          resourceType: event.resourceType,
          resourceId: event.resourceId,
          metadata: event.metadata
        });
        recordUsage({
          eventType: "ats_adapter_run",
          resourceType: event.resourceType,
          resourceId: event.resourceId,
          metadata: event.metadata
        });
      }
    });
  }

  function recordUnsupportedClaimWarnings(
    packageId: string,
    jobId: string,
    warnings: string[]
  ) {
    if (warnings.length === 0) {
      return;
    }

    recordAudit({
      action: "unsupported_claim_warning_created",
      resourceType: "ApplicationPackage",
      resourceId: packageId,
      metadata: {
        jobId,
        warningCount: warnings.length
      }
    });
  }

  function packageContext(
    applicationPackage: ApplicationPackage
  ): ApplicationPackageContext | null {
    const job = normalizedJobs.find((item) => item.id === applicationPackage.jobId);
    if (!job) {
      return null;
    }

    return {
      profile,
      resume,
      job,
      match: jobMatches.find((match) => match.jobId === job.id) ?? null
    };
  }

  function latestBrowserSessionForPackage(
    packageId: string
  ): BrowserApplicationSession | null {
    return (
      browserSessions
        .filter((browserSession) => browserSession.applicationPackageId === packageId)
        .sort(
          (a, b) =>
            new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        )[0] ?? null
    );
  }

  function invalidateApprovedApplicationIfEdited(
    applicationPackage: ApplicationPackage
  ) {
    if (applicationPackage.status !== "approved") {
      return;
    }

    const result = changeApplicationStatus(
      currentSession,
      applicationPackage.applicationRecordId,
      "needs_review"
    );
    recordWorkflowResult(result);
  }

  function recordWorkflowResult(result: {
    applications: ApplicationRecord[];
    matches: JobMatch[];
    auditAction: string;
    application: ApplicationRecord;
    auditMetadata: Record<string, string | number | boolean | null>;
  }) {
    setApplications(result.applications);
    setJobMatches(result.matches);
    recordAudit({
      action: result.auditAction,
      resourceType: "ApplicationRecord",
      resourceId: result.application.id,
      metadata: result.auditMetadata
    });

    if (result.auditAction === "job_saved") {
      recordFeedback({
        eventType: "job_saved",
        resourceType: "ApplicationRecord",
        resourceId: result.application.id,
        metadata: result.auditMetadata
      });
    } else if (
      result.auditAction === "job_rejected" ||
      result.auditAction === "job_marked_not_interested"
    ) {
      recordFeedback({
        eventType: "job_rejected",
        resourceType: "ApplicationRecord",
        resourceId: result.application.id,
        metadata: result.auditMetadata
      });
    } else if (
      result.auditAction === "job_promoted_to_apply_review" ||
      result.auditAction === "job_moved_to_maybe"
    ) {
      recordFeedback({
        eventType: "score_overridden",
        resourceType: "ApplicationRecord",
        resourceId: result.application.id,
        metadata: result.auditMetadata
      });
    } else if (result.auditAction === "manually_applied") {
      recordFeedback({
        eventType: "manually_applied",
        resourceType: "ApplicationRecord",
        resourceId: result.application.id,
        metadata: result.auditMetadata
      });
      recordFeedback({
        eventType: "application_submitted",
        resourceType: "ApplicationRecord",
        resourceId: result.application.id,
        metadata: result.auditMetadata
      });
      recordUsage({
        eventType: "application_submitted",
        resourceType: "ApplicationRecord",
        resourceId: result.application.id,
        metadata: result.auditMetadata
      });
    }

    recordOutcomeForApplication(result.application);
  }

  function handleSaveProfile(draft: UserProfileDraft) {
    const savedProfile = saveUserProfile(currentSession, draft, profile);
    const savedCompletion = calculateProfileCompletion(savedProfile);
    setProfile(savedProfile);
    recordAudit({
      action: "profile.saved",
      resourceType: "UserProfile",
      resourceId: savedProfile.id,
      metadata: {
        completionPercent: savedCompletion.percent
      }
    });
  }

  function handleUploadResume(file: File) {
    const uploadedResume = createResumeUpload(currentSession, {
      fileName: file.name,
      fileType: file.type || "unknown",
      hasLocalFile: true
    });
    saveResume(currentSession, uploadedResume);
    setResume(uploadedResume);
    recordAudit({
      action: "resume.uploaded",
      resourceType: "Resume",
      resourceId: uploadedResume.id,
      metadata: {
        status: uploadedResume.status,
        fileExtension: extensionFor(file.name),
        hasLocalFile: true
      }
    });
    recordUsage({
      eventType: "resume_uploaded",
      resourceType: "Resume",
      resourceId: uploadedResume.id,
      metadata: {
        fileExtension: extensionFor(file.name),
        hasLocalFile: true
      }
    });
  }

  function handlePlaceholderResume() {
    const placeholderResume = createResumeUpload(currentSession, {
      fileName: "resume-record.pdf",
      hasLocalFile: false
    });
    saveResume(currentSession, placeholderResume);
    setResume(placeholderResume);
    recordAudit({
      action: "resume.placeholder_created",
      resourceType: "Resume",
      resourceId: placeholderResume.id,
      metadata: {
        status: placeholderResume.status,
        fileExtension: "pdf",
        hasLocalFile: false
      }
    });
    recordUsage({
      eventType: "resume_uploaded",
      resourceType: "Resume",
      resourceId: placeholderResume.id,
      metadata: {
        fileExtension: "pdf",
        hasLocalFile: false
      }
    });
  }

  function handleClearWorkspace() {
    if (
      !window.confirm(
        "Clear all locally stored demo data for this workspace? This cannot be undone."
      )
    ) {
      return;
    }

    clearScopedWorkspace(currentSession.tenant.id, currentSession.userId);
    window.location.hash = "dashboard";
    window.location.reload();
  }

  function handleSaveJobSourceConfig(draft: JobSourceConfigDraft) {
    const config = upsertJobSourceConfig(currentSession, draft);
    setJobSourceConfigs(loadJobSourceConfigs(currentSession));
    recordAudit({
      action: "job_source_config.saved",
      resourceType: "JobSourceConfig",
      resourceId: config.id,
      metadata: {
        source: config.source,
        schedule: config.schedule,
        enabled: config.enabled
      }
    });
    recordUsage({
      eventType: "job_source_created",
      resourceType: "JobSourceConfig",
      resourceId: config.id,
      metadata: {
        source: config.source,
        schedule: config.schedule,
        enabled: config.enabled
      }
    });
  }

  async function handleRunScan(configId: string) {
    setIsScanning(true);
    recordUsage({
      eventType: "scan_run_started",
      resourceType: "JobSourceConfig",
      resourceId: configId
    });

    try {
      const result = await runManualScan(currentSession, configId);
      setJobSourceConfigs(result.configs);
      setNormalizedJobs(result.jobs);
      setScanRuns(loadScanRuns(currentSession));
      recordAudit({
        action:
          result.scanRun.status === "succeeded"
            ? "job_scan.succeeded"
            : "job_scan.failed",
        resourceType: "ScanRun",
        resourceId: result.scanRun.id,
        metadata: {
          source: result.scanRun.source,
          jobsFetched: result.scanRun.jobsFetched,
          jobsInserted: result.scanRun.jobsInserted,
          duplicatesSkipped: result.scanRun.duplicatesSkipped
        }
      });
      recordUsage({
        eventType: "job_ingested",
        resourceType: "ScanRun",
        resourceId: result.scanRun.id,
        quantity: result.scanRun.jobsInserted,
        metadata: {
          source: result.scanRun.source,
          jobsFetched: result.scanRun.jobsFetched,
          duplicatesSkipped: result.scanRun.duplicatesSkipped
        }
      });
    } finally {
      setIsScanning(false);
    }
  }

  function handleManualImport(url: string) {
    const summary = importManualJobUrl(currentSession, url);
    setNormalizedJobs(summary.jobs);
    recordAudit({
      action: "manual_job_url.imported",
      resourceType: "NormalizedJob",
      resourceId: summary.jobs[0]?.id ?? "manual_import",
      metadata: {
        inserted: summary.inserted,
        duplicatesSkipped: summary.duplicatesSkipped
      }
    });
    recordUsage({
      eventType: "job_ingested",
      resourceType: "NormalizedJob",
      resourceId: summary.jobs[0]?.id ?? "manual_import",
      quantity: summary.inserted,
      metadata: {
        source: "manual",
        duplicatesSkipped: summary.duplicatesSkipped
      }
    });
  }

  async function handleScoreJobsNow() {
    setIsScoring(true);

    try {
      const result = await scoreJobsForProfile(
        currentSession,
        profile,
        normalizedJobs,
        jobMatches
      );
      setNormalizedJobs(result.jobs);
      setJobMatches(result.matches);
      recordAudit({
        action: "job_scoring.completed",
        resourceType: "JobMatch",
        resourceId: "batch_score_jobs",
        metadata: {
          scoredCount: result.scoredCount,
          applyCount: result.applyCount,
          maybeCount: result.maybeCount,
          browseCount: result.browseCount,
          skipCount: result.skipCount,
          profileIncomplete: Boolean(result.profileWarning)
        }
      });
      recordUsage({
        eventType: "job_scored",
        resourceType: "JobMatch",
        resourceId: "batch_score_jobs",
        quantity: result.scoredCount,
        metadata: {
          applyCount: result.applyCount,
          maybeCount: result.maybeCount,
          browseCount: result.browseCount,
          skipCount: result.skipCount
        }
      });
      recordUsage({
        eventType: "llm_tokens_used",
        resourceType: "JobMatch",
        resourceId: "batch_score_jobs",
        quantity: 0,
        unit: "tokens",
        metadata: { modelMode: "deterministic" }
      });
      const scoredJobIds = new Set(normalizedJobs.map((job) => job.id));
      result.matches
        .filter((match) => scoredJobIds.has(match.jobId))
        .forEach((match) => {
          recordAIOutput({
            outputType: "match_score",
            resourceType: "JobMatch",
            resourceId: match.id,
            modelName: match.modelName,
            promptVersion: match.promptVersion,
            provider: "local",
            mode: "deterministic",
            inputHash: match.jobId,
            outputHash: `${match.overallScore}-${match.recommendation}`
          });
        });
    } finally {
      setIsScoring(false);
    }
  }

  async function handleDashboardJobAction(
    jobId: string,
    action: DashboardJobAction,
    notes?: string
  ) {
    const result = applyDashboardJobAction(currentSession, jobId, action, { notes });
    recordWorkflowResult(result);

    if (action !== "start_application_prep") {
      return;
    }

    const job = normalizedJobs.find((item) => item.id === jobId);
    if (!job) {
      return;
    }

    const packageResult = await generateApplicationPackage({
      session: currentSession,
      application: result.application,
      profile,
      resume,
      job,
      match: jobMatches.find((match) => match.jobId === jobId) ?? null
    });

    setApplicationPackages(loadApplicationPackages(currentSession));
    setApplicationAnswers(loadApplicationAnswers(currentSession));
    recordAudit({
      action: "application_package_generated",
      resourceType: "ApplicationPackage",
      resourceId: packageResult.package.id,
      metadata: {
        jobId,
        applicationRecordId: result.application.id,
        generationMode: packageResult.package.generationMode,
        warningCount: packageResult.warningsCreated.length
      }
    });
    recordFeedback({
      eventType: "application_package_generated",
      resourceType: "ApplicationPackage",
      resourceId: packageResult.package.id,
      metadata: {
        jobId,
        applicationRecordId: result.application.id,
        warningCount: packageResult.warningsCreated.length
      }
    });
    recordUsage({
      eventType: "application_package_generated",
      resourceType: "ApplicationPackage",
      resourceId: packageResult.package.id,
      metadata: {
        jobId,
        generationMode: packageResult.package.generationMode,
        warningCount: packageResult.warningsCreated.length
      }
    });
    recordUsage({
      eventType: "llm_tokens_used",
      resourceType: "ApplicationPackage",
      resourceId: packageResult.package.id,
      quantity: 0,
      unit: "tokens",
      metadata: { modelMode: packageResult.package.generationMode }
    });
    recordAIOutput({
      outputType: "application_package",
      resourceType: "ApplicationPackage",
      resourceId: packageResult.package.id,
      modelName: packageResult.package.modelName,
      promptVersion: packageResult.package.promptVersion,
      provider: "local",
      mode: packageResult.package.generationMode,
      inputHash: packageResult.package.inputHash,
      outputHash: packageResult.package.outputHash
    });
    packageResult.answers.forEach((answer) => {
      recordAIOutput({
        outputType: "application_answer",
        resourceType: "ApplicationAnswer",
        resourceId: answer.id,
        modelName: packageResult.package.modelName,
        promptVersion: packageResult.package.promptVersion,
        provider: "local",
        mode: packageResult.package.generationMode,
        inputHash: packageResult.package.inputHash,
        outputHash: packageResult.package.outputHash
      });
    });
    recordUnsupportedClaimWarnings(
      packageResult.package.id,
      jobId,
      packageResult.warningsCreated
    );
    navigateToPackage(packageResult.package.id);
  }

  function handleApplicationStatusChange(
    applicationId: string,
    status: ApplicationStatus
  ) {
    const result = changeApplicationStatus(currentSession, applicationId, status);
    recordWorkflowResult(result);
  }

  function handleApplicationNotesChange(applicationId: string, notes: string) {
    const result = changeApplicationNotes(currentSession, applicationId, notes);
    recordWorkflowResult(result);
  }

  function handleSaveApplicationPackageDraft(
    packageId: string,
    updates: { resumeMarkdown: string; coverLetter: string }
  ) {
    const existing = applicationPackages.find(
      (applicationPackage) => applicationPackage.id === packageId
    );
    if (!existing) {
      return;
    }

    const context = packageContext(existing);
    if (!context) {
      return;
    }

    const result = updateApplicationPackageDraft(
      currentSession,
      packageId,
      updates,
      context
    );
    setApplicationPackages(loadApplicationPackages(currentSession));
    setApplicationAnswers(loadApplicationAnswers(currentSession));
    invalidateApprovedApplicationIfEdited(existing);
    recordAudit({
      action: "application_package_edited",
      resourceType: "ApplicationPackage",
      resourceId: packageId,
      metadata: {
        jobId: result.package.jobId,
        status: result.package.status,
        warningCount: result.warningsCreated.length
      }
    });
    if (existing.resumeMarkdown !== updates.resumeMarkdown) {
      recordFeedback({
        eventType: "resume_edited",
        resourceType: "ApplicationPackage",
        resourceId: packageId,
        metadata: {
          jobId: result.package.jobId,
          warningCount: result.warningsCreated.length
        }
      });
    }
    if (existing.coverLetter !== updates.coverLetter) {
      recordFeedback({
        eventType: "cover_letter_edited",
        resourceType: "ApplicationPackage",
        resourceId: packageId,
        metadata: {
          jobId: result.package.jobId,
          warningCount: result.warningsCreated.length
        }
      });
    }
    recordUnsupportedClaimWarnings(
      packageId,
      result.package.jobId,
      result.warningsCreated
    );
  }

  function handleSaveApplicationAnswer(answerId: string, answer: string) {
    const existingAnswer = applicationAnswers.find((item) => item.id === answerId);
    const existingPackage = applicationPackages.find(
      (applicationPackage) =>
        applicationPackage.id === existingAnswer?.applicationPackageId
    );
    if (!existingPackage) {
      return;
    }

    const context = packageContext(existingPackage);
    if (!context) {
      return;
    }

    const result = updateApplicationAnswerDraft(
      currentSession,
      answerId,
      answer,
      context
    );
    setApplicationPackages(loadApplicationPackages(currentSession));
    setApplicationAnswers(loadApplicationAnswers(currentSession));
    invalidateApprovedApplicationIfEdited(existingPackage);
    recordAudit({
      action: "application_answer_edited",
      resourceType: "ApplicationAnswer",
      resourceId: answerId,
      metadata: {
        packageId: result.package.id,
        jobId: result.package.jobId,
        warningCount: result.warningsCreated.length
      }
    });
    recordFeedback({
      eventType: "application_answer_edited",
      resourceType: "ApplicationAnswer",
      resourceId: answerId,
      metadata: {
        packageId: result.package.id,
        jobId: result.package.jobId,
        warningCount: result.warningsCreated.length
      }
    });
    recordUnsupportedClaimWarnings(
      result.package.id,
      result.package.jobId,
      result.warningsCreated
    );
  }

  function handleApproveApplicationPackage(packageId: string) {
    const result = approveApplicationPackage(currentSession, packageId);
    setApplicationPackages(result.packages);
    setApplications(result.applications);
    recordAudit({
      action: "application_package_approved",
      resourceType: "ApplicationPackage",
      resourceId: packageId,
      metadata: {
        jobId: result.package.jobId,
        applicationRecordId: result.application.id,
        status: result.application.status
      }
    });
    recordFeedback({
      eventType: "application_package_approved",
      resourceType: "ApplicationPackage",
      resourceId: packageId,
      metadata: {
        jobId: result.package.jobId,
        applicationRecordId: result.application.id
      }
    });
  }

  function handleRejectApplicationPackage(packageId: string) {
    const result = rejectApplicationPackage(currentSession, packageId);
    setApplicationPackages(result.packages);
    setApplications(result.applications);
    recordAudit({
      action: "application_package_rejected",
      resourceType: "ApplicationPackage",
      resourceId: packageId,
      metadata: {
        jobId: result.package.jobId,
        applicationRecordId: result.application.id,
        status: result.application.status
      }
    });
    recordFeedback({
      eventType: "application_package_rejected",
      resourceType: "ApplicationPackage",
      resourceId: packageId,
      metadata: {
        jobId: result.package.jobId,
        applicationRecordId: result.application.id
      }
    });
  }

  async function handleStartBrowserApply(packageId: string) {
    const applicationPackage = applicationPackages.find((item) => item.id === packageId);
    if (!applicationPackage) {
      return;
    }

    const job = normalizedJobs.find((item) => item.id === applicationPackage.jobId);
    const application = applications.find(
      (item) => item.id === applicationPackage.applicationRecordId
    );
    if (!job || !application) {
      return;
    }

    const result = await startBrowserApplicationSession({
      session: currentSession,
      actorUserId: currentSession.userId,
      applicationPackage,
      application,
      job,
      profile,
      resume,
      answers: applicationAnswers.filter(
        (answer) => answer.applicationPackageId === applicationPackage.id
      )
    });
    recordBrowserResult(result);
    navigateToBrowserSession(result.session.id);
  }

  function handleMarkBrowserSessionReady(sessionId: string) {
    const result = markBrowserSessionReadyForReview(currentSession, sessionId);
    recordBrowserResult(result);
  }

  function handleApproveBrowserSubmit(sessionId: string) {
    const result = approveBrowserSubmit(currentSession, sessionId, {
      actorUserId: currentSession.userId,
      approvedByUser: true
    });
    recordBrowserResult(result);
  }

  async function handleSubmitApprovedBrowserApplication(sessionId: string) {
    try {
      const result = await submitApprovedBrowserApplication(
        currentSession,
        sessionId,
        undefined,
        { actorUserId: currentSession.userId }
      );
      recordBrowserResult(result);
    } finally {
      setAuditLogs(loadAuditLogs(currentSession).slice(0, 50));
    }
  }

  function handleMarkBrowserSessionManualRequired(sessionId: string) {
    const result = markBrowserSessionManualRequired(
      currentSession,
      sessionId,
      "User chose manual completion from the browser session review."
    );
    recordBrowserResult(result);
  }

  function persistExtensionAuditEvents(events: ExtensionAuditEvent[]) {
    events.forEach((event) => {
      recordAudit({
        action: event.action,
        resourceType: event.resourceType,
        resourceId: event.resourceId,
        metadata: event.metadata
      });

      if (event.action === "extension_connection_requested") {
        recordFeedback({
          eventType: "extension_session_started",
          resourceType: event.resourceType,
          resourceId: event.resourceId,
          metadata: event.metadata
        });
        recordUsage({
          eventType: "extension_session_started",
          resourceType: event.resourceType,
          resourceId: event.resourceId,
          metadata: event.metadata
        });
      } else if (event.action === "application_page_analyzed") {
        recordFeedback({
          eventType: "extension_page_analyzed",
          resourceType: event.resourceType,
          resourceId: event.resourceId,
          metadata: event.metadata
        });
        recordUsage({
          eventType: "extension_page_analyzed",
          resourceType: event.resourceType,
          resourceId: event.resourceId,
          metadata: event.metadata
        });
      } else if (event.action === "fill_plan_created") {
        recordFeedback({
          eventType: "extension_fill_plan_created",
          resourceType: event.resourceType,
          resourceId: event.resourceId,
          metadata: event.metadata
        });
        recordUsage({
          eventType: "extension_fill_plan_created",
          resourceType: event.resourceType,
          resourceId: event.resourceId,
          metadata: event.metadata
        });
      } else if (event.action === "user_approved_field_fill") {
        recordFeedback({
          eventType: "user_approved_extension_fill",
          resourceType: event.resourceType,
          resourceId: event.resourceId,
          metadata: event.metadata
        });
      } else if (event.action === "extension_fields_filled") {
        recordFeedback({
          eventType: "extension_fields_filled",
          resourceType: event.resourceType,
          resourceId: event.resourceId,
          metadata: event.metadata
        });
        recordUsage({
          eventType: "extension_fields_filled",
          resourceType: event.resourceType,
          resourceId: event.resourceId,
          metadata: event.metadata
        });
      } else if (event.action === "user_approved_extension_submit") {
        recordFeedback({
          eventType: "extension_submit_approved",
          resourceType: event.resourceType,
          resourceId: event.resourceId,
          metadata: event.metadata
        });
        recordUsage({
          eventType: "extension_submit_approved",
          resourceType: event.resourceType,
          resourceId: event.resourceId,
          metadata: event.metadata
        });
      } else if (event.action === "extension_submit_completed") {
        recordFeedback({
          eventType: "extension_submit_completed",
          resourceType: event.resourceType,
          resourceId: event.resourceId,
          metadata: event.metadata
        });
      } else if (event.action === "extension_session_failed") {
        recordFeedback({
          eventType: "extension_session_failed",
          resourceType: event.resourceType,
          resourceId: event.resourceId,
          metadata: event.metadata
        });
        recordUsage({
          eventType: "extension_session_failed",
          resourceType: event.resourceType,
          resourceId: event.resourceId,
          metadata: event.metadata
        });
      }
    });
  }

  function recordExtensionResult(result: ExtensionResult) {
    setExtensionSessions(result.sessions);
    persistExtensionAuditEvents(result.auditEvents);
  }

  function buildDemoExtensionPageStructure(
    job: { applicationUrl: string; title: string; company: string } | null
  ): ExtensionPageStructure {
    const url =
      job?.applicationUrl ||
      "http://127.0.0.1:5174/extension/demo/demo-application.html";
    let hostname = "demo.local";
    try {
      hostname = new URL(url).hostname || hostname;
    } catch {
      hostname = "demo.local";
    }
    const title = job
      ? `${job.title} — ${job.company}`
      : "Demo Job Application — Agentic Job Ops";
    return {
      pageUrl: url,
      pageTitle: title,
      hostname,
      hasSubmitButton: true,
      hasCaptcha: false,
      hasLoginChallenge: false,
      capturedAt: new Date().toISOString(),
      fields: [
        {
          fieldId: "first_name",
          label: "First name",
          fieldType: "text",
          inputName: "first_name",
          inputId: "first_name",
          placeholder: "",
          required: true,
          sensitive: false,
          hasValue: false
        },
        {
          fieldId: "last_name",
          label: "Last name",
          fieldType: "text",
          inputName: "last_name",
          inputId: "last_name",
          placeholder: "",
          required: true,
          sensitive: false,
          hasValue: false
        },
        {
          fieldId: "email",
          label: "Email",
          fieldType: "email",
          inputName: "email",
          inputId: "email",
          placeholder: "",
          required: true,
          sensitive: false,
          hasValue: false
        },
        {
          fieldId: "phone",
          label: "Phone",
          fieldType: "phone",
          inputName: "phone",
          inputId: "phone",
          placeholder: "",
          required: false,
          sensitive: false,
          hasValue: false
        },
        {
          fieldId: "linkedin",
          label: "LinkedIn URL",
          fieldType: "url",
          inputName: "linkedin",
          inputId: "linkedin",
          placeholder: "",
          required: false,
          sensitive: false,
          hasValue: false
        },
        {
          fieldId: "resume",
          label: "Resume",
          fieldType: "file",
          inputName: "resume",
          inputId: "resume",
          placeholder: "",
          required: true,
          sensitive: false,
          hasValue: false
        },
        {
          fieldId: "custom_question",
          label: "What makes you a strong fit?",
          fieldType: "textarea",
          inputName: "custom_question",
          inputId: "custom_question",
          placeholder: "",
          required: false,
          sensitive: false,
          hasValue: false
        },
        {
          fieldId: "eeoc_gender",
          label: "Gender (voluntary demographic question)",
          fieldType: "select",
          inputName: "eeoc_gender",
          inputId: "eeoc_gender",
          placeholder: "",
          required: false,
          sensitive: true,
          hasValue: false
        }
      ]
    };
  }

  function handleConnectExtensionDemo(browserSessionId: string) {
    const browserSession = browserSessions.find((item) => item.id === browserSessionId);
    if (!browserSession) {
      return;
    }
    const job = normalizedJobs.find((item) => item.id === browserSession.jobId) ?? null;
    const applicationPackage = applicationPackages.find(
      (item) => item.id === browserSession.applicationPackageId
    );
    const application = applications.find(
      (item) => item.id === browserSession.applicationRecordId
    );
    const created = createExtensionSession(currentSession, {
      extensionInstanceId: `demo_${globalThis.crypto.randomUUID()}`,
      pageUrl:
        job?.applicationUrl ||
        "http://127.0.0.1:5174/extension/demo/demo-application.html",
      pageTitle: job ? `${job.title} — ${job.company}` : "Demo Job Application",
      hostname: "demo.local",
      applicationPackageId: applicationPackage?.id ?? null,
      applicationRecordId: application?.id ?? null,
      jobId: job?.id ?? null,
      browserApplicationSessionId: browserSession.id
    });
    recordExtensionResult(created);

    const authorized = authorizeExtensionSession(currentSession, created.session.id, {
      actorUserId: currentSession.userId,
      authorizedByUser: true
    });
    recordExtensionResult(authorized);

    const ingested = ingestExtensionPageStructure(
      currentSession,
      created.session.id,
      buildDemoExtensionPageStructure(job)
    );
    recordExtensionResult(ingested);

    if (ingested.session.status === "page_analyzed") {
      const planned = createExtensionFillPlan(currentSession, created.session.id, {
        applicationPackage: applicationPackage ?? null,
        application: application ?? null,
        job,
        profile
      });
      recordExtensionResult(planned);
    }
  }

  function handleApproveExtensionFill(extensionSessionId: string) {
    const result = approveExtensionFill(currentSession, extensionSessionId, {
      actorUserId: currentSession.userId,
      approvedByUser: true
    });
    recordExtensionResult(result);
  }

  function handleSimulateExtensionFill(extensionSessionId: string) {
    const session = extensionSessions.find((item) => item.id === extensionSessionId);
    if (!session) {
      return;
    }
    const fillableIds = session.fillPlan
      .filter((item) => item.action === "fill" || item.action === "upload")
      .map((item) => item.fieldId);
    const result = recordExtensionFieldsFilled(
      currentSession,
      extensionSessionId,
      fillableIds
    );
    recordExtensionResult(result);
  }

  function handleApproveExtensionSubmit(extensionSessionId: string) {
    const result = approveExtensionSubmit(currentSession, extensionSessionId, {
      actorUserId: currentSession.userId,
      approvedByUser: true
    });
    recordExtensionResult(result);
  }

  async function handleSimulateExtensionSubmitComplete(extensionSessionId: string) {
    const session = extensionSessions.find((item) => item.id === extensionSessionId);
    const linkedPackage = session?.applicationPackageId
      ? applicationPackages.find((item) => item.id === session.applicationPackageId) ?? null
      : null;
    try {
      const result = recordExtensionSubmitCompleted(
        currentSession,
        extensionSessionId,
        {
          actorUserId: currentSession.userId,
          confirmationDetected: true,
          applicationPackage: linkedPackage
        }
      );
      recordExtensionResult(result);
    } finally {
      setAuditLogs(loadAuditLogs(currentSession).slice(0, 50));
    }
  }

  function handleDisconnectExtension(extensionSessionId: string) {
    const result = disconnectExtensionSession(
      currentSession,
      extensionSessionId,
      "User disconnected the extension session from the app."
    );
    recordExtensionResult(result);
  }

  function handleExtensionManualRequired(extensionSessionId: string) {
    const result = markExtensionManualRequired(
      currentSession,
      extensionSessionId,
      "User chose manual completion from the extension review."
    );
    recordExtensionResult(result);
  }

  function persistRealSiteAuditEvents(events: RealSiteAuditEvent[]) {
    events.forEach((event) => {
      recordAudit({
        action: event.action,
        resourceType: event.resourceType,
        resourceId: event.resourceId,
        metadata: event.metadata
      });
      if (event.action === "real_site_dry_run_requested") {
        recordFeedback({
          eventType: "real_site_dry_run_started",
          resourceType: event.resourceType,
          resourceId: event.resourceId,
          metadata: event.metadata
        });
        recordUsage({
          eventType: "real_site_dry_run_started",
          resourceType: event.resourceType,
          resourceId: event.resourceId,
          metadata: event.metadata
        });
      } else if (event.action === "real_site_snapshot_saved") {
        recordFeedback({
          eventType: "real_site_snapshot_saved",
          resourceType: event.resourceType,
          resourceId: event.resourceId,
          metadata: event.metadata
        });
        recordUsage({
          eventType: "real_site_snapshot_saved",
          resourceType: event.resourceType,
          resourceId: event.resourceId,
          metadata: event.metadata
        });
      } else if (event.action === "real_site_snapshot_exported") {
        recordFeedback({
          eventType: "real_site_snapshot_exported",
          resourceType: event.resourceType,
          resourceId: event.resourceId,
          metadata: event.metadata
        });
        recordUsage({
          eventType: "real_site_snapshot_exported",
          resourceType: event.resourceType,
          resourceId: event.resourceId,
          metadata: event.metadata
        });
      }
    });
  }

  function handleRequestRealSiteDryRun(sourceUrl: string): {
    snapshot: RealSiteDryRunSnapshot;
    comparison: RealSiteDryRunComparison | null;
  } | null {
    let parsedHostname = "";
    try {
      parsedHostname = new URL(sourceUrl).hostname;
    } catch {
      parsedHostname = "";
    }
    const linkedExtensionSession = parsedHostname
      ? extensionSessions
          .filter((session) => session.hostname === parsedHostname)
          .sort(
            (a, b) =>
              new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
          )[0] ?? null
      : null;
    try {
      const result = createDryRunSnapshot(currentSession, {
        sourceUrl,
        extensionSession: linkedExtensionSession
      });
      setRealSiteSnapshots(result.snapshots);
      persistRealSiteAuditEvents(result.auditEvents);
      return { snapshot: result.snapshot, comparison: result.comparison };
    } finally {
      setAuditLogs(loadAuditLogs(currentSession).slice(0, 50));
    }
  }

  function handleExportRealSiteSnapshot(snapshotId: string) {
    const snapshot = realSiteSnapshots.find((item) => item.id === snapshotId);
    if (!snapshot) {
      return;
    }
    const events = recordSnapshotExport(currentSession, snapshot);
    persistRealSiteAuditEvents(events);
  }

  function persistCareerOpsAuditEvents(events: CareerOpsAuditEvent[]) {
    events.forEach((event) => {
      recordAudit({
        action: event.action,
        resourceType: event.resourceType,
        resourceId: event.resourceId,
        metadata: event.metadata
      });

      if (event.action === "career_ops_run_started") {
        recordFeedback({
          eventType: "career_ops_run_started",
          resourceType: event.resourceType,
          resourceId: event.resourceId,
          metadata: event.metadata
        });
        recordUsage({
          eventType: "career_ops_run_started",
          resourceType: event.resourceType,
          resourceId: event.resourceId,
          metadata: event.metadata
        });
      } else if (event.action === "career_ops_scoring_completed") {
        recordUsage({
          eventType: "career_ops_jobs_scored",
          resourceType: event.resourceType,
          resourceId: event.resourceId,
          metadata: event.metadata
        });
      } else if (event.action === "career_ops_package_preparation_completed") {
        recordUsage({
          eventType: "career_ops_packages_prepared",
          resourceType: event.resourceType,
          resourceId: event.resourceId,
          metadata: event.metadata
        });
      } else if (event.action === "career_ops_digest_created") {
        recordFeedback({
          eventType: "career_ops_digest_created",
          resourceType: event.resourceType,
          resourceId: event.resourceId,
          metadata: event.metadata
        });
        recordUsage({
          eventType: "career_ops_digest_created",
          resourceType: event.resourceType,
          resourceId: event.resourceId,
          metadata: event.metadata
        });
      } else if (event.action === "career_ops_run_completed") {
        recordFeedback({
          eventType: "career_ops_run_completed",
          resourceType: event.resourceType,
          resourceId: event.resourceId,
          metadata: event.metadata
        });
      } else if (event.action === "career_ops_run_failed") {
        recordFeedback({
          eventType: "career_ops_run_failed",
          resourceType: event.resourceType,
          resourceId: event.resourceId,
          metadata: event.metadata
        });
      }
    });
  }

  function applyCareerOpsResult(result: CareerOpsRunResult) {
    setCareerOpsRuns(result.runs);
    persistCareerOpsAuditEvents(result.auditEvents);
    // Refresh downstream collections that may have changed during the run.
    setNormalizedJobs(loadNormalizedJobs(currentSession));
    setJobMatches(loadJobMatches(currentSession));
    setApplications(loadApplications(currentSession));
    setApplicationPackages(loadApplicationPackages(currentSession));
    setApplicationAnswers(loadApplicationAnswers(currentSession));
    setScanRuns(loadScanRuns(currentSession));
    setJobSourceConfigs(loadJobSourceConfigs(currentSession));
    setCompanyIntelligence(loadCompanyIntelligence(currentSession));
    setJobRiskSignals(loadJobRiskSignals(currentSession));
  }

  function persistIntelligenceAuditEvents(events: IntelligenceAuditEvent[]) {
    events.forEach((event) => {
      recordAudit({
        action: event.action,
        resourceType: event.resourceType,
        resourceId: event.resourceId,
        metadata: event.metadata
      });
      if (
        event.action === "company_intelligence_generated" ||
        event.action === "company_intelligence_refreshed"
      ) {
        recordUsage({
          eventType: "company_intelligence_generated",
          resourceType: event.resourceType,
          resourceId: event.resourceId,
          metadata: event.metadata
        });
      } else if (event.action === "job_risk_signal_created") {
        recordUsage({
          eventType: "job_risk_signal_created",
          resourceType: event.resourceType,
          resourceId: event.resourceId,
          metadata: event.metadata
        });
      } else if (event.action === "recruiter_lead_added") {
        recordUsage({
          eventType: "recruiter_lead_added",
          resourceType: event.resourceType,
          resourceId: event.resourceId,
          metadata: event.metadata
        });
      }
    });
  }

  async function handleGenerateIntelligenceForJob(jobId: string) {
    const job = normalizedJobs.find((item) => item.id === jobId);
    if (!job) return;
    setIsGeneratingIntelligence(true);
    try {
      const result = await generateCompanyIntelligence(currentSession, job, profile);
      persistIntelligenceAuditEvents(result.auditEvents);
      setCompanyIntelligence(loadCompanyIntelligence(currentSession));
      setJobRiskSignals(loadJobRiskSignals(currentSession));
    } finally {
      setIsGeneratingIntelligence(false);
    }
  }

  function handleMarkIntelligenceHelpful(intelligenceId: string) {
    recordFeedback({
      eventType: "intelligence_helpful",
      resourceType: "CompanyIntelligence",
      resourceId: intelligenceId,
      metadata: {}
    });
  }

  function handleMarkIntelligenceNotHelpful(intelligenceId: string) {
    recordFeedback({
      eventType: "intelligence_not_helpful",
      resourceType: "CompanyIntelligence",
      resourceId: intelligenceId,
      metadata: {}
    });
  }

  function persistOnboardingAuditEvents(events: OnboardingAuditEvent[]) {
    events.forEach((event) => {
      recordAudit({
        action: event.action,
        resourceType: event.resourceType,
        resourceId: event.resourceId,
        metadata: event.metadata
      });
      if (event.action === "onboarding_target_roles_selected") {
        recordFeedback({
          eventType: "onboarding_target_roles_selected",
          resourceType: event.resourceType,
          resourceId: event.resourceId,
          metadata: event.metadata
        });
        recordUsage({
          eventType: "onboarding_target_roles_selected",
          resourceType: event.resourceType,
          resourceId: event.resourceId,
          metadata: event.metadata
        });
      } else if (event.action === "onboarding_jobs_recommended") {
        recordFeedback({
          eventType: "onboarding_jobs_recommended",
          resourceType: event.resourceType,
          resourceId: event.resourceId,
          metadata: event.metadata
        });
        recordUsage({
          eventType: "onboarding_jobs_recommended",
          resourceType: event.resourceType,
          resourceId: event.resourceId,
          metadata: event.metadata
        });
      } else if (event.action === "onboarding_application_prep_started") {
        recordFeedback({
          eventType: "onboarding_application_prep_started",
          resourceType: event.resourceType,
          resourceId: event.resourceId,
          metadata: event.metadata
        });
        recordUsage({
          eventType: "onboarding_application_prep_started",
          resourceType: event.resourceType,
          resourceId: event.resourceId,
          metadata: event.metadata
        });
      } else if (event.action === "onboarding_completed") {
        recordFeedback({
          eventType: "onboarding_completed",
          resourceType: event.resourceType,
          resourceId: event.resourceId,
          metadata: event.metadata
        });
      }
    });
  }

  async function handleOnboardingSelectRoles(roles: string[]) {
    const result = await recordTargetRolesSelected(currentSession, roles);
    setOnboardingState(result.state);
    persistOnboardingAuditEvents(result.auditEvents);
  }

  async function handleOnboardingGenerate(roles: string[]) {
    setIsOnboardingRecommending(true);
    try {
      const result = await recommendApplyReadyJobs(currentSession, {
        targetRoles: roles,
        profile,
        allowDemoJobs: true
      });
      setOnboardingState(result.state);
      setOnboardingResult(result);
      setNormalizedJobs(loadNormalizedJobs(currentSession));
      setJobMatches(loadJobMatches(currentSession));
      persistOnboardingAuditEvents(result.auditEvents);
    } finally {
      setIsOnboardingRecommending(false);
    }
  }

  async function handleOnboardingReview(jobId: string) {
    const result = await recordOnboardingJobReviewed(currentSession, jobId);
    setOnboardingState(result.state);
    persistOnboardingAuditEvents(result.auditEvents);
  }

  async function handleOnboardingStartPrep(jobId: string) {
    const result = await recordOnboardingApplicationPrepStarted(
      currentSession,
      jobId
    );
    setOnboardingState(result.state);
    persistOnboardingAuditEvents(result.auditEvents);
    // Reuse the existing dashboard handler so a draft package gets generated.
    await handleDashboardJobAction(jobId, "start_application_prep");
  }

  function handleOnboardingSaveJob(jobId: string) {
    void handleDashboardJobAction(jobId, "save_for_later");
  }

  function handleOnboardingDismissJob(jobId: string) {
    void handleDashboardJobAction(jobId, "mark_not_interested");
  }

  async function handleOnboardingComplete(
    reason: "user_chose_dashboard" | "user_started_review" | "user_started_prep"
  ) {
    const result = await recordOnboardingCompleted(currentSession, reason);
    setOnboardingState(result.state);
    persistOnboardingAuditEvents(result.auditEvents);
  }

  function persistResumeIntelligenceAuditEvents(
    events: ResumeIntelligenceAuditEvent[]
  ) {
    events.forEach((event) => {
      recordAudit({
        action: event.action,
        resourceType: event.resourceType,
        resourceId: event.resourceId,
        metadata: event.metadata
      });
      if (event.action === "resume_intelligence_started") {
        recordUsage({
          eventType: "resume_intelligence_started",
          resourceType: event.resourceType,
          resourceId: event.resourceId,
          metadata: event.metadata
        });
      } else if (event.action === "resume_intelligence_completed") {
        recordUsage({
          eventType: "resume_intelligence_completed",
          resourceType: event.resourceType,
          resourceId: event.resourceId,
          metadata: event.metadata
        });
      } else if (event.action === "resume_fix_suggestion_created") {
        recordUsage({
          eventType: "resume_fix_suggestion_created",
          resourceType: event.resourceType,
          resourceId: event.resourceId,
          metadata: event.metadata
        });
      } else if (event.action === "job_target_recommendations_generated") {
        recordUsage({
          eventType: "job_target_recommendations_generated",
          resourceType: event.resourceType,
          resourceId: event.resourceId,
          metadata: event.metadata
        });
      } else if (event.action === "resume_profile_confirmed") {
        recordFeedback({
          eventType: "resume_profile_confirmed",
          resourceType: event.resourceType,
          resourceId: event.resourceId,
          metadata: event.metadata
        });
      } else if (event.action === "job_target_recommendations_confirmed") {
        recordFeedback({
          eventType: "job_target_recommendations_confirmed",
          resourceType: event.resourceType,
          resourceId: event.resourceId,
          metadata: event.metadata
        });
        recordUsage({
          eventType: "job_target_recommendations_confirmed",
          resourceType: event.resourceType,
          resourceId: event.resourceId,
          metadata: event.metadata
        });
      } else if (event.action === "job_target_recommendations_edited") {
        recordFeedback({
          eventType: "job_target_recommendations_edited",
          resourceType: event.resourceType,
          resourceId: event.resourceId,
          metadata: event.metadata
        });
      }
    });
  }

  async function handleAnalyzeResumeIntelligence() {
    if (!resume) return;
    setIsAnalyzingResume(true);
    try {
      const result = await analyzeResumeIntelligence(currentSession, resume);
      setResumeIntelligenceReports(loadResumeIntelligenceReports(currentSession));
      setJobTargetRecommendations(loadJobTargetRecommendations(currentSession));
      persistResumeIntelligenceAuditEvents(result.auditEvents);
    } finally {
      setIsAnalyzingResume(false);
    }
  }

  function handleConfirmResumeProfile() {
    if (!resume) return;
    const report = getResumeIntelligenceReport(currentSession, resume.id);
    if (!report) return;
    const extracted = report.extractedProfile;
    const confidence = report.confidenceByField;
    let appliedFieldCount = 0;
    function pickHigh(fieldKey: keyof typeof confidence, value: string): string | null {
      if (
        confidence[fieldKey] === "high" &&
        value &&
        value.trim().length > 0
      ) {
        appliedFieldCount += 1;
        return value;
      }
      return null;
    }
    // Build a draft that overrides only the high-confidence string fields.
    const baseProfile = profile;
    const mergedDraft = {
      fullName: pickHigh("fullName", extracted.fullName) ?? baseProfile?.fullName ?? "",
      email: pickHigh("email", extracted.email) ?? baseProfile?.email ?? "",
      phone:
        confidence.phone === "high" && extracted.phone
          ? (() => {
              appliedFieldCount += 1;
              return extracted.phone;
            })()
          : baseProfile?.phone ?? "",
      location:
        confidence.location === "high" && extracted.location
          ? (() => {
              appliedFieldCount += 1;
              return extracted.location;
            })()
          : baseProfile?.location ?? "",
      workAuthorization:
        extracted.workAuthorization || baseProfile?.workAuthorization || "",
      linkedinUrl:
        pickHigh("linkedinUrl", extracted.linkedinUrl) ??
        baseProfile?.linkedinUrl ??
        "",
      portfolioUrl:
        pickHigh("portfolioUrl", extracted.portfolioUrl) ??
        baseProfile?.portfolioUrl ??
        "",
      githubUrl:
        pickHigh("githubUrl", extracted.githubUrl) ?? baseProfile?.githubUrl ?? "",
      targetTitles: (baseProfile?.targetTitles ?? []).join(", "),
      targetLocations: (baseProfile?.targetLocations ?? []).join(", "),
      targetIndustries: (baseProfile?.targetIndustries ?? []).join(", "),
      remotePreference: baseProfile?.remotePreference ?? "any",
      salaryMin: baseProfile?.salaryMin ? String(baseProfile.salaryMin) : "",
      salaryTarget: baseProfile?.salaryTarget
        ? String(baseProfile.salaryTarget)
        : "",
      companiesToAvoid: (baseProfile?.companiesToAvoid ?? []).join(", "),
      companiesToPrioritize: (baseProfile?.companiesToPrioritize ?? []).join(", "),
      careerSummary: baseProfile?.careerSummary ?? "",
      verifiedFacts: Array.from(
        new Set([
          ...(baseProfile?.verifiedFacts ?? []),
          ...extracted.resumeStrengths,
          ...extracted.quantifiedAchievements
        ])
      ).join(", ")
    };
    handleSaveProfile(mergedDraft);
    const events = recordResumeProfileConfirmed(report, appliedFieldCount);
    persistResumeIntelligenceAuditEvents(events);
  }

  async function handleConfirmRecommendedTargets(selection: {
    selectedRoles: string[];
    selectedIndustries: string[];
    recommendedSeniority: string;
  }) {
    if (!resume) return;
    const recommendation = getJobTargetRecommendation(currentSession, resume.id);
    if (!recommendation) return;
    // Persist confirmation audits
    const events = recordRecommendationsConfirmed(recommendation, selection);
    persistResumeIntelligenceAuditEvents(events);
    // Sync the onboarding state with the confirmed roles
    const onboarding = await recordTargetRolesSelected(
      currentSession,
      selection.selectedRoles
    );
    setOnboardingState(onboarding.state);
    persistOnboardingAuditEvents(onboarding.auditEvents);
    // Optionally update the user profile target titles + industries so other
    // pages reflect the choice. Use the same merge helper as profile confirm.
    if (profile) {
      const draft = {
        fullName: profile.fullName,
        email: profile.email,
        phone: profile.phone,
        location: profile.location,
        workAuthorization: profile.workAuthorization,
        linkedinUrl: profile.linkedinUrl,
        portfolioUrl: profile.portfolioUrl,
        githubUrl: profile.githubUrl,
        targetTitles: selection.selectedRoles.join(", "),
        targetLocations: profile.targetLocations.join(", "),
        targetIndustries: Array.from(
          new Set([...profile.targetIndustries, ...selection.selectedIndustries])
        ).join(", "),
        remotePreference: profile.remotePreference,
        salaryMin: profile.salaryMin ? String(profile.salaryMin) : "",
        salaryTarget: profile.salaryTarget ? String(profile.salaryTarget) : "",
        companiesToAvoid: profile.companiesToAvoid.join(", "),
        companiesToPrioritize: profile.companiesToPrioritize.join(", "),
        careerSummary: profile.careerSummary,
        verifiedFacts: profile.verifiedFacts.join(", ")
      };
      handleSaveProfile(draft);
    }
  }

  function handleDismissRiskSignal(signalId: string) {
    const remaining = jobRiskSignals.filter((signal) => signal.id !== signalId);
    saveJobRiskSignals(currentSession, remaining);
    setJobRiskSignals(remaining);
    recordAudit({
      action: "intelligence_warning_acknowledged",
      resourceType: "JobRiskSignal",
      resourceId: signalId,
      metadata: {}
    });
    recordFeedback({
      eventType: "risk_signal_dismissed",
      resourceType: "JobRiskSignal",
      resourceId: signalId,
      metadata: {}
    });
  }

  async function handleRunCareerOpsNow() {
    if (isCareerOpsRunning) {
      return;
    }
    setIsCareerOpsRunning(true);
    try {
      const result = await runCareerOps(currentSession, { mode: "manual" });
      applyCareerOpsResult(result);
    } finally {
      setIsCareerOpsRunning(false);
    }
  }

  function handleSaveCareerOpsSettings(next: {
    scheduleMode: CareerOpsScheduleMode;
    preparePackagesForHighScoreJobs: boolean;
    highScoreThreshold: number;
    overrideHighRiskPackagePrep: boolean;
  }) {
    const saved = saveCareerOpsSettings(currentSession, next);
    setCareerOpsSettings(saved);
    recordAudit({
      action: "career_ops_settings_updated",
      resourceType: "CareerOpsSettings",
      resourceId: saved.id,
      metadata: {
        scheduleMode: saved.scheduleMode,
        preparePackagesForHighScoreJobs: saved.preparePackagesForHighScoreJobs,
        highScoreThreshold: saved.highScoreThreshold,
        overrideHighRiskPackagePrep: saved.overrideHighRiskPackagePrep
      }
    });
  }

  async function handleRunEvals() {
    setIsRunningEvals(true);

    try {
      const result = await runEvalSuite(currentSession);
      setEvalCases(result.cases);
      setEvalRuns(loadEvalRuns(currentSession));
      setEvalResults(loadEvalResults(currentSession));
      recordAudit({
        action:
          result.run.failCount > 0 ? "eval_run.failed" : "eval_run.completed",
        resourceType: "EvalRun",
        resourceId: result.run.id,
        metadata: {
          suite: result.run.suite,
          passCount: result.run.passCount,
          failCount: result.run.failCount
        }
      });
    } finally {
      setIsRunningEvals(false);
    }
  }

  function renderRoute() {
    switch (route) {
      case "profile-setup":
        return (
          <ProfileSetupPage
            session={currentSession}
            profile={profile}
            onSave={handleSaveProfile}
          />
        );
      case "resume-upload":
        return (
          <ResumeUploadPage
            resume={resume}
            onUpload={handleUploadResume}
            onPlaceholderUpload={handlePlaceholderResume}
          />
        );
      case "career-profile":
        return (
          <CareerProfilePage
            session={currentSession}
            profile={profile}
            resume={resume}
            onSave={handleSaveProfile}
          />
        );
      case "ingestion":
        return (
          <IngestionAdminPage
            configs={jobSourceConfigs}
            scanRuns={scanRuns}
            jobs={normalizedJobs}
            isScanning={isScanning}
            onSaveConfig={handleSaveJobSourceConfig}
            onRunScan={handleRunScan}
            onManualImport={handleManualImport}
          />
        );
      case "jobs":
        return (
          <JobDashboardPage
            jobs={normalizedJobs}
            matches={jobMatches}
            applications={applications}
            packages={applicationPackages}
            profileCompletion={completion}
            isScoring={isScoring}
            onScoreJobs={handleScoreJobsNow}
            onJobAction={handleDashboardJobAction}
            onOpenPackage={navigateToPackage}
          />
        );
      case "tracker":
        return (
          <ApplicationTrackerPage
            applications={applications}
            jobs={normalizedJobs}
            matches={jobMatches}
            packages={applicationPackages}
            browserSessions={browserSessions}
            onStatusChange={handleApplicationStatusChange}
            onNotesChange={handleApplicationNotesChange}
            onOpenPackage={navigateToPackage}
            onOpenBrowserSession={navigateToBrowserSession}
          />
        );
      case "onboarding": {
        const currentReport = resume
          ? resumeIntelligenceReports.find((r) => r.resumeId === resume.id) ??
            null
          : null;
        const currentRecommendation = resume
          ? jobTargetRecommendations.find((r) => r.resumeId === resume.id) ??
            null
          : null;
        return (
          <OnboardingPage
            profile={profile}
            resume={resume}
            state={onboardingState}
            applications={applications}
            isRecommending={isOnboardingRecommending}
            lastResult={onboardingResult}
            resumeIntelligenceReport={currentReport}
            jobTargetRecommendation={currentRecommendation}
            isAnalyzingResume={isAnalyzingResume}
            onAnalyzeResume={handleAnalyzeResumeIntelligence}
            onConfirmResumeProfile={handleConfirmResumeProfile}
            onConfirmRecommendedTargets={handleConfirmRecommendedTargets}
            onSelectRoles={handleOnboardingSelectRoles}
            onGenerateRecommendations={handleOnboardingGenerate}
            onReviewJob={handleOnboardingReview}
            onStartApplicationPrep={handleOnboardingStartPrep}
            onSaveJob={handleOnboardingSaveJob}
            onDismissJob={handleOnboardingDismissJob}
            onCompleteOnboarding={handleOnboardingComplete}
            onNavigateProfile={() => navigate("profile-setup")}
            onNavigateResume={() => navigate("resume-upload")}
            onNavigateDashboard={() => navigate("dashboard")}
            onNavigateJobQueue={() => navigate("jobs")}
          />
        );
      }
      case "career-ops":
        return (
          <CareerOpsPage
            settings={careerOpsSettings}
            runs={careerOpsRuns}
            isRunning={isCareerOpsRunning}
            jobs={normalizedJobs}
            matches={jobMatches}
            intelligence={companyIntelligence}
            riskSignals={jobRiskSignals}
            onRunNow={handleRunCareerOpsNow}
            onSaveSettings={handleSaveCareerOpsSettings}
          />
        );
      case "extension-setup":
        return (
          <ExtensionSetupPage
            extensionSessions={extensionSessions}
            auditLogs={auditLogs}
            usageEvents={usageEvents}
            demoApplicationUrl="/extension/demo/demo-application.html"
            realSiteSnapshots={realSiteSnapshots}
            onRequestRealSiteDryRun={handleRequestRealSiteDryRun}
            onExportRealSiteSnapshot={handleExportRealSiteSnapshot}
          />
        );
      case "admin":
        return (
          <AdminSystemPage
            jobs={normalizedJobs}
            matches={jobMatches}
            packages={applicationPackages}
            browserSessions={browserSessions}
            extensionSessions={extensionSessions}
            applications={applications}
            auditLogs={auditLogs}
            feedbackEvents={feedbackEvents}
            usageEvents={usageEvents}
            evalRuns={evalRuns}
            evalResults={evalResults}
            outcomes={applicationOutcomes}
            aiOutputMetadata={aiOutputMetadata}
            isRunningEvals={isRunningEvals}
            onRunEvals={handleRunEvals}
          />
        );
      case "package-review": {
        const applicationPackage =
          applicationPackages.find((item) => item.id === selectedPackageId) ?? null;
        const job = applicationPackage
          ? normalizedJobs.find((item) => item.id === applicationPackage.jobId) ?? null
          : null;
        const application = applicationPackage
          ? applications.find(
              (item) => item.id === applicationPackage.applicationRecordId
            ) ?? null
          : null;
        const match = job
          ? jobMatches.find((item) => item.jobId === job.id) ?? null
          : null;
        const answers = applicationPackage
          ? applicationAnswers.filter(
              (answer) => answer.applicationPackageId === applicationPackage.id
            )
          : [];

        const jobIntelligence = job
          ? companyIntelligence.find((item) => item.jobId === job.id) ?? null
          : null;
        const jobRiskSignalsForJob = job
          ? jobRiskSignals.filter((signal) => signal.jobId === job.id)
          : [];
        const recruiterLeadsForJob = job
          ? recruiterLeads.filter((lead) => lead.jobId === job.id)
          : [];

        return (
          <ApplicationPackagePage
            applicationPackage={applicationPackage}
            answers={answers}
            application={application}
            job={job}
            match={match}
            browserSession={
              applicationPackage
                ? latestBrowserSessionForPackage(applicationPackage.id)
                : null
            }
            intelligence={jobIntelligence}
            riskSignals={jobRiskSignalsForJob}
            recruiterLeads={recruiterLeadsForJob}
            isGeneratingIntelligence={isGeneratingIntelligence}
            onBack={() => navigate("tracker")}
            onSavePackage={handleSaveApplicationPackageDraft}
            onSaveAnswer={handleSaveApplicationAnswer}
            onApprove={handleApproveApplicationPackage}
            onReject={handleRejectApplicationPackage}
            onStartBrowserApply={handleStartBrowserApply}
            onOpenBrowserSession={navigateToBrowserSession}
            onGenerateIntelligence={() =>
              job ? handleGenerateIntelligenceForJob(job.id) : undefined
            }
            onMarkIntelligenceHelpful={() =>
              jobIntelligence ? handleMarkIntelligenceHelpful(jobIntelligence.id) : undefined
            }
            onMarkIntelligenceNotHelpful={() =>
              jobIntelligence ? handleMarkIntelligenceNotHelpful(jobIntelligence.id) : undefined
            }
            onDismissRiskSignal={handleDismissRiskSignal}
          />
        );
      }
      case "browser-session": {
        const browserSession =
          browserSessions.find((item) => item.id === selectedBrowserSessionId) ??
          null;
        const applicationPackage = browserSession
          ? applicationPackages.find(
              (item) => item.id === browserSession.applicationPackageId
            ) ?? null
          : null;
        const application = browserSession
          ? applications.find(
              (item) => item.id === browserSession.applicationRecordId
            ) ?? null
          : null;
        const job = browserSession
          ? normalizedJobs.find((item) => item.id === browserSession.jobId) ?? null
          : null;
        const match = job
          ? jobMatches.find((item) => item.jobId === job.id) ?? null
          : null;
        const linkedExtensionSession = browserSession
          ? extensionSessions
              .filter((item) => item.browserApplicationSessionId === browserSession.id)
              .sort(
                (a, b) =>
                  new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
              )[0] ?? null
          : null;

        return (
          <BrowserSessionReviewPage
            browserSession={browserSession}
            applicationPackage={applicationPackage}
            application={application}
            job={job}
            match={match}
            extensionSession={linkedExtensionSession}
            onBack={() => navigate("tracker")}
            onMarkReadyForReview={handleMarkBrowserSessionReady}
            onApproveSubmit={handleApproveBrowserSubmit}
            onSubmitApproved={handleSubmitApprovedBrowserApplication}
            onManualRequired={handleMarkBrowserSessionManualRequired}
            onConnectExtensionDemo={handleConnectExtensionDemo}
            onApproveExtensionFill={handleApproveExtensionFill}
            onSimulateExtensionFill={handleSimulateExtensionFill}
            onApproveExtensionSubmit={handleApproveExtensionSubmit}
            onSimulateExtensionSubmitComplete={
              handleSimulateExtensionSubmitComplete
            }
            onDisconnectExtension={handleDisconnectExtension}
            onExtensionManualRequired={handleExtensionManualRequired}
          />
        );
      }
      case "dashboard":
      default:
        return (
          <DashboardHome
            completion={completion}
            resume={resume}
            applications={applications}
            jobs={normalizedJobs}
            matches={jobMatches}
            sourceConfigCount={jobSourceConfigs.length}
            auditLogs={auditLogs}
            onScoreJobs={handleScoreJobsNow}
            isScoring={isScoring}
            onClearWorkspace={isDevelopment ? handleClearWorkspace : undefined}
            onNavigate={navigate}
            routes={{
              profile: "profile-setup",
              resume: "resume-upload",
              ingestion: "ingestion",
              jobs: "jobs",
              tracker: "tracker",
              careerOps: "career-ops"
            }}
            careerOpsSettings={careerOpsSettings}
            careerOpsRuns={careerOpsRuns}
            isCareerOpsRunning={isCareerOpsRunning}
            onRunCareerOpsNow={handleRunCareerOpsNow}
          />
        );
    }
  }

  return (
    <AppShell
      currentRoute={route}
      navigationItems={navigationItems}
      session={currentSession}
      completion={completion}
      resume={resume}
      onNavigate={navigate}
    >
      {renderRoute()}
    </AppShell>
  );
}
