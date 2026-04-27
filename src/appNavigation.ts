import {
  BarChart3,
  BriefcaseBusiness,
  CalendarClock,
  ClipboardList,
  DatabaseZap,
  FileUp,
  Inbox,
  Plug,
  Rocket,
  Sparkles,
  UserCog,
  UserRound
} from "lucide-react";
import type { NavigationItem } from "./components/AppShell";
import type { OnboardingState } from "./models/domain";

/**
 * Pure navigation + route-resolution helpers for the App shell.
 *
 * Lives outside App.tsx so React Fast Refresh treats App.tsx as a
 * pure-component module — mixing component and non-component exports
 * forces full reloads on every edit (vitejs/vite-plugin-react
 * "consistent-components-exports" rule). All behaviour is unchanged
 * from when these symbols were colocated with the App component.
 */

export type RouteId =
  | "dashboard"
  | "action-center"
  | "autopilot-settings"
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

export const primaryNavigationItems: NavigationItem<RouteId>[] = [
  { id: "action-center", label: "Action Center", icon: Inbox, section: "primary" },
  { id: "onboarding", label: "Onboarding", icon: Rocket, section: "primary" },
  { id: "jobs", label: "Job Matches", icon: BriefcaseBusiness, section: "primary" },
  { id: "tracker", label: "Applications", icon: ClipboardList, section: "primary" },
  { id: "resume-upload", label: "Resume", icon: FileUp, section: "primary" },
  {
    id: "autopilot-settings",
    label: "Autopilot",
    icon: Sparkles,
    section: "primary"
  }
];

export const advancedNavigationItems: NavigationItem<RouteId>[] = [
  { id: "ingestion", label: "Ingestion", icon: DatabaseZap, section: "advanced" },
  { id: "career-ops", label: "Career Ops", icon: CalendarClock, section: "advanced" },
  {
    id: "extension-setup",
    label: "Extension Setup",
    icon: Plug,
    section: "advanced"
  },
  { id: "admin", label: "Admin/System", icon: BarChart3, section: "advanced" },
  { id: "profile-setup", label: "Profile setup", icon: UserRound, section: "advanced" },
  { id: "career-profile", label: "Career profile", icon: UserCog, section: "advanced" }
];

export const navigationItems: NavigationItem<RouteId>[] = [
  ...primaryNavigationItems,
  ...advancedNavigationItems
];

const routeIds: RouteId[] = [
  "dashboard",
  "package-review",
  "browser-session",
  ...navigationItems.map((item) => item.id)
];

export function isOnboardingComplete(
  state: Pick<OnboardingState, "onboardingCompletedAt">
): boolean {
  return Boolean(state.onboardingCompletedAt);
}

export function defaultRouteForOnboarding(onboardingComplete: boolean): RouteId {
  return onboardingComplete ? "action-center" : "onboarding";
}

export function routeAfterDashboardRedirect(
  route: RouteId,
  onboardingComplete: boolean
): RouteId {
  return route === "dashboard" ? defaultRouteForOnboarding(onboardingComplete) : route;
}

export function resolveRouteFromHash(
  hash: string,
  onboardingComplete: boolean
): RouteId {
  const route = hash.replace("#", "");
  if (route.startsWith("package-review:")) {
    return "package-review";
  }

  if (route.startsWith("browser-session:")) {
    return "browser-session";
  }

  if (!route) {
    return defaultRouteForOnboarding(onboardingComplete);
  }

  return routeIds.includes(route as RouteId)
    ? (route as RouteId)
    : defaultRouteForOnboarding(onboardingComplete);
}

export function routeFromHash(onboardingComplete: boolean): RouteId {
  return resolveRouteFromHash(window.location.hash, onboardingComplete);
}

export function packageIdFromHash(): string | null {
  const route = window.location.hash.replace("#", "");
  if (!route.startsWith("package-review:")) {
    return null;
  }

  return route.replace("package-review:", "") || null;
}

export function browserSessionIdFromHash(): string | null {
  const route = window.location.hash.replace("#", "");
  if (!route.startsWith("browser-session:")) {
    return null;
  }

  return route.replace("browser-session:", "") || null;
}
