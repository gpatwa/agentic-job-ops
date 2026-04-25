import type { ProfileCompletion, UserProfile } from "../models/domain";

const requiredFieldLabels: Array<{
  key: keyof UserProfile;
  label: string;
}> = [
  { key: "fullName", label: "Full name" },
  { key: "email", label: "Email" },
  { key: "location", label: "Location" },
  { key: "workAuthorization", label: "Work authorization" },
  { key: "targetTitles", label: "Target titles" },
  { key: "targetLocations", label: "Target locations" },
  { key: "targetIndustries", label: "Target industries" },
  { key: "remotePreference", label: "Remote preference" },
  { key: "careerSummary", label: "Career summary" },
  { key: "verifiedFacts", label: "Verified facts" }
];

function hasValue(value: UserProfile[keyof UserProfile]): boolean {
  if (Array.isArray(value)) {
    return value.length > 0;
  }

  if (typeof value === "string") {
    return value.trim().length > 0;
  }

  return value !== null && value !== undefined;
}

export function calculateProfileCompletion(
  profile: UserProfile | null
): ProfileCompletion {
  if (!profile) {
    return {
      completedFields: 0,
      totalFields: requiredFieldLabels.length,
      percent: 0,
      missingFields: requiredFieldLabels.map((field) => field.label)
    };
  }

  const missingFields = requiredFieldLabels
    .filter((field) => !hasValue(profile[field.key]))
    .map((field) => field.label);
  const completedFields = requiredFieldLabels.length - missingFields.length;

  return {
    completedFields,
    totalFields: requiredFieldLabels.length,
    percent: Math.round((completedFields / requiredFieldLabels.length) * 100),
    missingFields
  };
}
