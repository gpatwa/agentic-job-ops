import type { AppSession, UserProfile } from "../models/domain";
import { ProfileForm } from "../components/ProfileForm";
import type { UserProfileDraft } from "../services/profileService";

interface CareerProfilePageProps {
  session: AppSession;
  profile: UserProfile | null;
  onSave: (draft: UserProfileDraft) => void;
}

export function CareerProfilePage({
  session,
  profile,
  onSave
}: CareerProfilePageProps) {
  return (
    <ProfileForm
      session={session}
      profile={profile}
      title="Review career profile"
      description="Keep targets, constraints, and verified facts current before later phases score jobs or prepare application materials."
      onSave={onSave}
    />
  );
}
