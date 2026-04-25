import {
  BriefcaseBusiness,
  ClipboardList,
  DatabaseZap,
  FileUp,
  LayoutDashboard,
  UserCog,
  UserRound
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { AppShell, type NavigationItem } from "./components/AppShell";
import { currentSession } from "./data/currentSession";
import type {
  ApplicationAnswer,
  BrowserApplicationSession,
  ApplicationPackage,
  ApplicationRecord,
  ApplicationStatus,
  AuditLog,
  DashboardJobAction,
  JobMatch,
  Resume,
  UserProfile
} from "./models/domain";
import { ApplicationPackagePage } from "./pages/ApplicationPackagePage";
import { ApplicationTrackerPage } from "./pages/ApplicationTrackerPage";
import { BrowserSessionReviewPage } from "./pages/BrowserSessionReviewPage";
import { CareerProfilePage } from "./pages/CareerProfilePage";
import { DashboardHome } from "./pages/DashboardHome";
import { IngestionAdminPage } from "./pages/IngestionAdminPage";
import { JobDashboardPage } from "./pages/JobDashboardPage";
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
  approveBrowserSubmit,
  loadBrowserApplicationSessions,
  markBrowserSessionManualRequired,
  markBrowserSessionReadyForReview,
  startBrowserApplicationSession,
  submitApprovedBrowserApplication,
  type BrowserApplicationResult
} from "./services/browserApplicationAssistant";

type RouteId =
  | "dashboard"
  | "profile-setup"
  | "resume-upload"
  | "career-profile"
  | "ingestion"
  | "jobs"
  | "tracker"
  | "package-review"
  | "browser-session";

const navigationItems: NavigationItem<RouteId>[] = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "profile-setup", label: "Profile setup", icon: UserRound },
  { id: "resume-upload", label: "Resume upload", icon: FileUp },
  { id: "career-profile", label: "Career profile", icon: UserCog },
  { id: "ingestion", label: "Ingestion", icon: DatabaseZap },
  { id: "jobs", label: "Job queues", icon: BriefcaseBusiness },
  { id: "tracker", label: "Tracker", icon: ClipboardList }
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
  }

  async function handleRunScan(configId: string) {
    setIsScanning(true);

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
    const result = await submitApprovedBrowserApplication(currentSession, sessionId);
    recordBrowserResult(result);
  }

  function handleMarkBrowserSessionManualRequired(sessionId: string) {
    const result = markBrowserSessionManualRequired(
      currentSession,
      sessionId,
      "User chose manual completion from the browser session review."
    );
    recordBrowserResult(result);
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
            onBack={() => navigate("tracker")}
            onSavePackage={handleSaveApplicationPackageDraft}
            onSaveAnswer={handleSaveApplicationAnswer}
            onApprove={handleApproveApplicationPackage}
            onReject={handleRejectApplicationPackage}
            onStartBrowserApply={handleStartBrowserApply}
            onOpenBrowserSession={navigateToBrowserSession}
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

        return (
          <BrowserSessionReviewPage
            browserSession={browserSession}
            applicationPackage={applicationPackage}
            application={application}
            job={job}
            match={match}
            onBack={() => navigate("tracker")}
            onMarkReadyForReview={handleMarkBrowserSessionReady}
            onApproveSubmit={handleApproveBrowserSubmit}
            onSubmitApproved={handleSubmitApprovedBrowserApplication}
            onManualRequired={handleMarkBrowserSessionManualRequired}
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
              tracker: "tracker"
            }}
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
