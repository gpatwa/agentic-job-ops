import { describe, expect, it } from "vitest";
import {
  advancedNavigationItems,
  defaultRouteForOnboarding,
  primaryNavigationItems,
  resolveRouteFromHash,
  routeAfterDashboardRedirect
} from "../src/App";

describe("B2C navigation", () => {
  it("defaults new users to onboarding and onboarded users to Action Center", () => {
    expect(defaultRouteForOnboarding(false)).toBe("onboarding");
    expect(defaultRouteForOnboarding(true)).toBe("action-center");
    expect(resolveRouteFromHash("", false)).toBe("onboarding");
    expect(resolveRouteFromHash("", true)).toBe("action-center");
    expect(resolveRouteFromHash("#unknown", false)).toBe("onboarding");
    expect(resolveRouteFromHash("#unknown", true)).toBe("action-center");
  });

  it("redirects the legacy dashboard route to the correct B2C home", () => {
    expect(resolveRouteFromHash("#dashboard", false)).toBe("dashboard");
    expect(resolveRouteFromHash("#dashboard", true)).toBe("dashboard");
    expect(routeAfterDashboardRedirect("dashboard", false)).toBe("onboarding");
    expect(routeAfterDashboardRedirect("dashboard", true)).toBe("action-center");
  });

  it("keeps existing routes resolvable", () => {
    expect(resolveRouteFromHash("#jobs", true)).toBe("jobs");
    expect(resolveRouteFromHash("#tracker", true)).toBe("tracker");
    expect(resolveRouteFromHash("#resume-upload", true)).toBe("resume-upload");
    expect(resolveRouteFromHash("#ingestion", true)).toBe("ingestion");
    expect(resolveRouteFromHash("#career-ops", true)).toBe("career-ops");
    expect(resolveRouteFromHash("#extension-setup", true)).toBe("extension-setup");
    expect(resolveRouteFromHash("#admin", true)).toBe("admin");
    expect(resolveRouteFromHash("#profile-setup", true)).toBe("profile-setup");
    expect(resolveRouteFromHash("#career-profile", true)).toBe("career-profile");
    expect(resolveRouteFromHash("#package-review:pkg_1", true)).toBe(
      "package-review"
    );
    expect(resolveRouteFromHash("#browser-session:browser_1", true)).toBe(
      "browser-session"
    );
  });

  it("groups the simplified B2C sidebar into primary and advanced sections", () => {
    expect(primaryNavigationItems.map((item) => item.label)).toEqual([
      "Action Center",
      "Onboarding",
      "Job Matches",
      "Applications",
      "Resume",
      "Autopilot"
    ]);
    expect(primaryNavigationItems.every((item) => item.section === "primary")).toBe(
      true
    );

    expect(advancedNavigationItems.map((item) => item.label)).toEqual([
      "Ingestion",
      "Career Ops",
      "Extension Setup",
      "Admin/System",
      "Profile setup",
      "Career profile"
    ]);
    expect(
      advancedNavigationItems.every((item) => item.section === "advanced")
    ).toBe(true);
  });
});
