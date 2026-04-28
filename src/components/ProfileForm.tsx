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
  const normalized = resume.parsedText.toLowerCase();
  if (
    normalized.includes("resume parsing placeholder") ||
    normalized.includes("text extraction has not run yet")
  ) {
    return "Resume text extraction has not run yet. Add verified facts above before using this resume for application drafts.";
  }

  return resume.parsedText;
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

          <ApplicationDefaultsSection draft={draft} update={update} />
          <VoluntarySelfIdSection draft={draft} update={update} />
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


/**
 * Application defaults — values for the standard Greenhouse / Lever
 * questions every form asks. Stored on the local profile so the
 * Browser Assistant manual-apply helper can surface them as
 * paste-ready answers without forcing the candidate to re-think
 * them per job.
 */
function ApplicationDefaultsSection({
  draft,
  update
}: {
  draft: UserProfileDraft;
  update: <K extends keyof UserProfileDraft>(
    key: K,
    value: UserProfileDraft[K]
  ) => void;
}) {
  return (
    <section className="rounded-lg border border-line bg-white p-5 shadow-soft">
      <h3 className="text-base font-semibold text-slate-950">
        Application defaults
      </h3>
      <p className="mt-1 text-sm text-slate-500">
        Common questions on Greenhouse / Lever forms. Filling these once
        means the assistant has a paste-ready answer for every application.
      </p>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <label className="space-y-2">
          <span className="text-sm font-medium text-slate-700">
            Will you require visa sponsorship now or in the future?
          </span>
          <select
            className="min-h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 shadow-sm focus:border-emerald-700"
            value={draft.visaSponsorshipNeeded}
            onChange={(event) =>
              update("visaSponsorshipNeeded", event.target.value)
            }
          >
            <option value="">— Choose —</option>
            <option value="No, I do not and will not need a visa sponsorship.">
              No, I do not and will not need a visa sponsorship
            </option>
            <option value="Yes, I currently need a visa sponsorship.">
              Yes, I currently need a visa sponsorship
            </option>
            <option value="Yes, I may need a visa sponsorship in the future.">
              Yes, I may need a visa sponsorship in the future
            </option>
            <option value="I am unsure and will discuss in the interview.">
              I am unsure and will discuss in the interview
            </option>
            <option value="Prefer not to say">Prefer not to say</option>
          </select>
        </label>
        <TextField
          label="How did you hear about us?"
          value={draft.howDidYouHearAboutUs}
          onChange={(value) => update("howDidYouHearAboutUs", value)}
          placeholder="LinkedIn, referral, Glassdoor, …"
        />
      </div>
    </section>
  );
}

/**
 * Voluntary self-identification — EEO-1 + Section 503. Stored only
 * in the local workspace; never logged; only ever leaves via the
 * candidate's own paste action. Defaults are empty; "Prefer not to
 * say" is one of the standard options the user can pick.
 */
function VoluntarySelfIdSection({
  draft,
  update
}: {
  draft: UserProfileDraft;
  update: <K extends keyof UserProfileDraft>(
    key: K,
    value: UserProfileDraft[K]
  ) => void;
}) {
  return (
    <section className="rounded-lg border border-line bg-white p-5 shadow-soft">
      <h3 className="text-base font-semibold text-slate-950">
        Voluntary self-identification (optional)
      </h3>
      <p className="mt-1 text-sm leading-6 text-slate-500">
        Many forms include EEO-1 / Section 503 demographic questions.
        Filling these is voluntary; "Prefer not to say" is always a valid
        answer. Stored only in your local workspace — never logged, never
        sent anywhere except via your own paste.
      </p>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <label className="space-y-2">
          <span className="text-sm font-medium text-slate-700">Gender identity</span>
          <select
            className="min-h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 shadow-sm focus:border-emerald-700"
            value={draft.genderIdentity}
            onChange={(event) => update("genderIdentity", event.target.value)}
          >
            <option value="">— Choose —</option>
            <option value="Female">Female</option>
            <option value="Male">Male</option>
            <option value="Non-binary">Non-binary</option>
            <option value="Decline to self-identify">
              Decline to self-identify
            </option>
            <option value="Prefer not to say">Prefer not to say</option>
          </select>
        </label>
        <label className="space-y-2">
          <span className="text-sm font-medium text-slate-700">Race / ethnicity</span>
          <select
            className="min-h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 shadow-sm focus:border-emerald-700"
            value={draft.raceEthnicity}
            onChange={(event) => update("raceEthnicity", event.target.value)}
          >
            <option value="">— Choose —</option>
            <option value="Hispanic or Latino">Hispanic or Latino</option>
            <option value="White (Not Hispanic or Latino)">
              White (Not Hispanic or Latino)
            </option>
            <option value="Black or African American (Not Hispanic or Latino)">
              Black or African American (Not Hispanic or Latino)
            </option>
            <option value="Asian (Not Hispanic or Latino)">
              Asian (Not Hispanic or Latino)
            </option>
            <option value="American Indian or Alaska Native (Not Hispanic or Latino)">
              American Indian or Alaska Native (Not Hispanic or Latino)
            </option>
            <option value="Native Hawaiian or Other Pacific Islander (Not Hispanic or Latino)">
              Native Hawaiian or Other Pacific Islander (Not Hispanic or Latino)
            </option>
            <option value="Two or More Races (Not Hispanic or Latino)">
              Two or More Races (Not Hispanic or Latino)
            </option>
            <option value="Prefer not to say">Prefer not to say</option>
          </select>
        </label>
        <label className="space-y-2">
          <span className="text-sm font-medium text-slate-700">Veteran status</span>
          <select
            className="min-h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 shadow-sm focus:border-emerald-700"
            value={draft.veteranStatus}
            onChange={(event) => update("veteranStatus", event.target.value)}
          >
            <option value="">— Choose —</option>
            <option value="I am a protected veteran.">
              I am a protected veteran
            </option>
            <option value="I am not a protected veteran.">
              I am not a protected veteran
            </option>
            <option value="I do not wish to answer.">
              I do not wish to answer
            </option>
          </select>
        </label>
        <label className="space-y-2">
          <span className="text-sm font-medium text-slate-700">
            Disability status
          </span>
          <select
            className="min-h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 shadow-sm focus:border-emerald-700"
            value={draft.disabilityStatus}
            onChange={(event) => update("disabilityStatus", event.target.value)}
          >
            <option value="">— Choose —</option>
            <option value="Yes, I have a disability, or have had one in the past.">
              Yes, I have a disability (or have had one in the past)
            </option>
            <option value="No, I do not have a disability and have not had one in the past.">
              No, I do not have a disability
            </option>
            <option value="I do not want to answer.">
              I do not want to answer
            </option>
          </select>
        </label>
      </div>
    </section>
  );
}
