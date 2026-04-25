import { describe, expect, it } from "vitest";
import { currentSession } from "../src/data/currentSession";
import { calculateProfileCompletion } from "../src/lib/profileCompletion";
import { createEmptyProfile } from "../src/services/profileService";

describe("calculateProfileCompletion", () => {
  it("returns zero completion when no profile exists", () => {
    const completion = calculateProfileCompletion(null);

    expect(completion.percent).toBe(0);
    expect(completion.missingFields).toContain("Full name");
  });

  it("counts filled required career fields", () => {
    const profile = {
      ...createEmptyProfile(currentSession),
      fullName: "Example User",
      email: "example@example.com",
      location: "Remote",
      workAuthorization: "Authorized",
      targetTitles: ["Product Manager"],
      targetLocations: ["Remote"],
      targetIndustries: ["SaaS"],
      careerSummary: "Builds useful products.",
      verifiedFacts: ["Led a launch"]
    };

    const completion = calculateProfileCompletion(profile);

    expect(completion.percent).toBe(100);
    expect(completion.missingFields).toEqual([]);
  });
});
