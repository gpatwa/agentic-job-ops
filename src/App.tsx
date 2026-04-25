import {
  BriefcaseBusiness,
  ClipboardList,
  FileUp,
  LayoutDashboard,
  UserCog,
  UserRound
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { AppShell, type NavigationItem } from "./components/AppShell";
import { currentSession } from "./data/currentSession";
import type { ApplicationRecord, AuditLog, Resume, UserProfile } from "./models/domain";
import { ApplicationTrackerPage } from "./pages/ApplicationTrackerPage";
import { CareerProfilePage } from "./pages/CareerProfilePage";
import { DashboardHome } from "./pages/DashboardHome";
import { JobDashboardPage } from "./pages/JobDashboardPage";
import { ProfileSetupPage } from "./pages/ProfileSetupPage";
import { ResumeUploadPage } from "./pages/ResumeUploadPage";
import { calculateProfileCompletion } from "./lib/profileCompletion";
import { appendAuditLog, loadAuditLogs } from "./services/auditLog";
import { loadApplications } from "./services/applicationService";
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
  | "jobs"
  | "tracker";

const navigationItems: NavigationItem<RouteId>[] = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "profile-setup", label: "Profile setup", icon: UserRound },
  { id: "resume-upload", label: "Resume upload", icon: FileUp },
  { id: "career-profile", label: "Career profile", icon: UserCog },
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
  const [applications] = useState<ApplicationRecord[]>(() =>
    loadApplications(currentSession)
  );
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
      case "jobs":
        return <JobDashboardPage />;
      case "tracker":
        return <ApplicationTrackerPage applications={applications} />;
      case "dashboard":
      default:
        return (
          <DashboardHome
            completion={completion}
            resume={resume}
            applications={applications}
            auditLogs={auditLogs}
            onNavigate={navigate}
            routes={{
              profile: "profile-setup",
              resume: "resume-upload",
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
