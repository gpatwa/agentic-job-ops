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
  ApplicationRecord,
  ApplicationStatus,
  AuditLog,
  DashboardJobAction,
  JobMatch,
  Resume,
  UserProfile
} from "./models/domain";
import { ApplicationTrackerPage } from "./pages/ApplicationTrackerPage";
import { CareerProfilePage } from "./pages/CareerProfilePage";
import { DashboardHome } from "./pages/DashboardHome";
import { IngestionAdminPage } from "./pages/IngestionAdminPage";
import { JobDashboardPage } from "./pages/JobDashboardPage";
import { ProfileSetupPage } from "./pages/ProfileSetupPage";
import { ResumeUploadPage } from "./pages/ResumeUploadPage";
import { calculateProfileCompletion } from "./lib/profileCompletion";
import { appendAuditLog, loadAuditLogs } from "./services/auditLog";
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

type RouteId =
  | "dashboard"
  | "profile-setup"
  | "resume-upload"
  | "career-profile"
  | "ingestion"
  | "jobs"
  | "tracker";

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

function routeFromHash(): RouteId {
  const route = window.location.hash.replace("#", "") as RouteId;
  return routeIds.includes(route) ? route : "dashboard";
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
    const handleHashChange = () => setRoute(routeFromHash());
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  const completion = useMemo(() => calculateProfileCompletion(profile), [profile]);

  function navigate(nextRoute: RouteId) {
    window.location.hash = nextRoute;
    setRoute(nextRoute);
  }

  function recordAudit(log: Parameters<typeof appendAuditLog>[1]) {
    const savedLog = appendAuditLog(currentSession, log);
    setAuditLogs((current) => [savedLog, ...current].slice(0, 50));
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
      fileName: "placeholder-resume.pdf",
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

  function handleDashboardJobAction(
    jobId: string,
    action: DashboardJobAction,
    notes?: string
  ) {
    const result = applyDashboardJobAction(currentSession, jobId, action, { notes });
    recordWorkflowResult(result);
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
            profileCompletion={completion}
            isScoring={isScoring}
            onScoreJobs={handleScoreJobsNow}
            onJobAction={handleDashboardJobAction}
          />
        );
      case "tracker":
        return (
          <ApplicationTrackerPage
            applications={applications}
            jobs={normalizedJobs}
            matches={jobMatches}
            onStatusChange={handleApplicationStatusChange}
            onNotesChange={handleApplicationNotesChange}
          />
        );
      case "dashboard":
      default:
        return (
          <DashboardHome
            completion={completion}
            resume={resume}
            applications={applications}
            jobs={normalizedJobs}
            matches={jobMatches}
            auditLogs={auditLogs}
            onScoreJobs={handleScoreJobsNow}
            isScoring={isScoring}
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
