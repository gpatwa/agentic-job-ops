import type { AppSession, UserProfile } from "../models/domain";
import { ProfileForm } from "../components/ProfileForm";
import type { UserProfileDraft } from "../services/profileService";

interface ProfileSetupPageProps {
  session: AppSession;
  profile: UserProfile | null;
  onSave: (draft: UserProfileDraft) => void;
}

export function ProfileSetupPage({
  session,
  profile,
  onSave
}: ProfileSetupPageProps) {
  return (
    <ProfileForm
      session={session}
      profile={profile}
      mode="setup"
      eyebrow="Onboarding"
      title="Set up your search basics"
      description="Add contact details and search targets so the system knows which jobs to bring into view."
      submitLabel="Save setup"
      onSave={onSave}
    />
  );
}
