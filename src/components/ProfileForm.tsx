import { Save } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import type { AppSession, Resume, UserProfile } from "../models/domain";
import {
  createEmptyProfile,
  profileToDraft,
  type UserProfileDraft
} from "../services/profileService";

interface ProfileFormProps {
  session: AppSession;
  profile: UserProfile | null;
  resume?: Resume | null;
  mode: "setup" | "career";
  eyebrow: string;
  title: string;
  description: string;
  submitLabel: string;
  onSave: (draft: UserProfileDraft) => void;
}

function TextField({
  label,
  value,
  onChange,
  type = "text",
  placeholder
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <label className="space-y-2">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <input
        className="min-h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 shadow-sm transition placeholder:text-slate-400 focus:border-emerald-700"
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function TextAreaField({
  label,
  value,
  onChange,
  placeholder
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="space-y-2 md:col-span-2">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <textarea
        className="min-h-28 w-full rounded-md border border-slate-300 bg-white px-3 py-3 text-sm leading-6 text-slate-950 shadow-sm transition placeholder:text-slate-400 focus:border-emerald-700"
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function resumeTextPreview(resume: Resume): string {
  return resume.parsedText
    .split(
      "Resume parsing placeholder: Phase 1 stores the upload record and reserves this field for a parser service. No resume content has been extracted yet."
    )
    .join(
      "Resume text extraction has not run yet. Add verified facts above before using this resume for application drafts."
    );
}

export function ProfileForm({
  session,
  profile,
  resume,
  mode,
  eyebrow,
  title,
  description,
  submitLabel,
  onSave
}: ProfileFormProps) {
  const [draft, setDraft] = useState<UserProfileDraft>(() =>
    profileToDraft(profile ?? createEmptyProfile(session))
  );
  const [message, setMessage] = useState<string>("");

  useEffect(() => {
    setDraft(profileToDraft(profile ?? createEmptyProfile(session)));
  }, [profile, session]);

  function update<K extends keyof UserProfileDraft>(
    key: K,
    value: UserProfileDraft[K]
  ) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");

    try {
      onSave(draft);
      setMessage("Profile saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to save profile.");
    }
  }

  return (
    <form className="space-y-6" onSubmit={handleSubmit}>
      <header className="max-w-3xl">
        <p className="text-sm font-semibold uppercase tracking-wide text-emerald-700">
          {eyebrow}
        </p>
        <h2 className="mt-2 text-3xl font-semibold text-slate-950">{title}</h2>
        <p className="mt-3 text-sm leading-6 text-slate-600">{description}</p>
      </header>

      {mode === "setup" ? (
        <>
          <section className="rounded-lg border border-line bg-white p-5 shadow-soft">
            <h3 className="text-base font-semibold text-slate-950">
              Contact and work preferences
            </h3>
            <p className="mt-1 text-sm text-slate-500">
              This helps match roles to your location, authorization, and preferred
              work style.
            </p>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <TextField
                label="Full name"
                value={draft.fullName}
                onChange={(value) => update("fullName", value)}
              />
              <TextField
                label="Email"
                type="email"
                value={draft.email}
                onChange={(value) => update("email", value)}
              />
              <TextField
                label="Phone"
                value={draft.phone}
                onChange={(value) => update("phone", value)}
              />
              <TextField
                label="Location"
                value={draft.location}
                onChange={(value) => update("location", value)}
              />
              <TextField
                label="Work authorization"
                value={draft.workAuthorization}
                onChange={(value) => update("workAuthorization", value)}
              />
              <label className="space-y-2">
                <span className="text-sm font-medium text-slate-700">
                  Remote preference
                </span>
                <select
                  className="min-h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 shadow-sm focus:border-emerald-700"
                  value={draft.remotePreference}
                  onChange={(event) =>
                    update(
                      "remotePreference",
                      event.target.value as UserProfile["remotePreference"]
                    )
                  }
                >
                  <option value="any">Any</option>
                  <option value="remote">Remote</option>
                  <option value="hybrid">Hybrid</option>
                  <option value="onsite">Onsite</option>
                </select>
              </label>
            </div>
          </section>

          <section className="rounded-lg border border-line bg-white p-5 shadow-soft">
            <h3 className="text-base font-semibold text-slate-950">
              Search targets
            </h3>
            <p className="mt-1 text-sm text-slate-500">
              Start broad enough to find good roles, then refine after scoring.
            </p>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <TextField
                label="Target titles"
                value={draft.targetTitles}
                onChange={(value) => update("targetTitles", value)}
                placeholder="Product Manager, AI Program Manager"
              />
              <TextField
                label="Target locations"
                value={draft.targetLocations}
                onChange={(value) => update("targetLocations", value)}
                placeholder="San Francisco, Remote"
              />
              <TextField
                label="Target industries"
                value={draft.targetIndustries}
                onChange={(value) => update("targetIndustries", value)}
                placeholder="SaaS, AI, Healthcare"
              />
              <TextField
                label="Minimum salary"
                value={draft.salaryMin}
                onChange={(value) => update("salaryMin", value)}
                placeholder="140000"
              />
              <TextField
                label="Target salary"
                value={draft.salaryTarget}
                onChange={(value) => update("salaryTarget", value)}
                placeholder="180000"
              />
            </div>
          </section>

          <section className="rounded-lg border border-line bg-white p-5 shadow-soft">
            <h3 className="text-base font-semibold text-slate-950">
              Public profile links
            </h3>
            <div className="mt-4 grid gap-4 md:grid-cols-3">
              <TextField
                label="LinkedIn URL"
                value={draft.linkedinUrl}
                onChange={(value) => update("linkedinUrl", value)}
                placeholder="https://www.linkedin.com/in/..."
              />
              <TextField
                label="Portfolio URL"
                value={draft.portfolioUrl}
                onChange={(value) => update("portfolioUrl", value)}
                placeholder="https://..."
              />
              <TextField
                label="GitHub URL"
                value={draft.githubUrl}
                onChange={(value) => update("githubUrl", value)}
                placeholder="https://github.com/..."
              />
            </div>
          </section>
        </>
      ) : (
        <>
          <section className="rounded-lg border border-line bg-white p-5 shadow-soft">
            <h3 className="text-base font-semibold text-slate-950">
              Verified career evidence
            </h3>
            <p className="mt-1 text-sm text-slate-500">
              Treat this as the source of truth for scoring and draft preparation.
              Only include claims you can stand behind.
            </p>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <TextAreaField
                label="Career summary"
                value={draft.careerSummary}
                onChange={(value) => update("careerSummary", value)}
                placeholder="A concise, factual summary of your background."
              />
              <TextAreaField
                label="Verified facts, skills, and tools"
                value={draft.verifiedFacts}
                onChange={(value) => update("verifiedFacts", value)}
                placeholder="Comma-separated facts, skills, tools, achievements, and resume evidence the system may use."
              />
            </div>
          </section>

          <section className="rounded-lg border border-line bg-white p-5 shadow-soft">
            <h3 className="text-base font-semibold text-slate-950">
              Target roles and strategy
            </h3>
            <p className="mt-1 text-sm text-slate-500">
              Use this to shape matching beyond basic onboarding preferences.
            </p>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <TextField
                label="Target roles"
                value={draft.targetTitles}
                onChange={(value) => update("targetTitles", value)}
                placeholder="Product Manager, AI Program Manager"
              />
              <TextField
                label="Target industries"
                value={draft.targetIndustries}
                onChange={(value) => update("targetIndustries", value)}
                placeholder="SaaS, AI, Healthcare"
              />
              <TextField
                label="Companies to prioritize"
                value={draft.companiesToPrioritize}
                onChange={(value) => update("companiesToPrioritize", value)}
              />
              <TextField
                label="Companies to avoid"
                value={draft.companiesToAvoid}
                onChange={(value) => update("companiesToAvoid", value)}
              />
            </div>
          </section>

          <section className="rounded-lg border border-line bg-white p-5 shadow-soft">
            <h3 className="text-base font-semibold text-slate-950">
              Resume-derived facts
            </h3>
            {resume ? (
              <p className="mt-3 rounded-md border border-slate-200 bg-panel p-4 text-sm leading-6 text-slate-600">
                {resumeTextPreview(resume)}
              </p>
            ) : (
              <p className="mt-2 text-sm leading-6 text-slate-500">
                Upload a resume to capture resume-derived evidence here. You can
                still add verified facts manually above.
              </p>
            )}
          </section>
        </>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <button
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-ink px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-700"
          type="submit"
        >
          <Save aria-hidden="true" size={18} />
          {submitLabel}
        </button>
        {message && <p className="text-sm font-medium text-emerald-700">{message}</p>}
      </div>
    </form>
  );
}
