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
      title="Set up your profile"
      description="Add only verified career information. Later application drafts will be constrained to these facts."
      onSave={onSave}
    />
  );
}
