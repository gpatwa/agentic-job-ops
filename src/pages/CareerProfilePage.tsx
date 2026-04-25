import type { AppSession, Resume, UserProfile } from "../models/domain";
import { ProfileForm } from "../components/ProfileForm";
import type { UserProfileDraft } from "../services/profileService";

interface CareerProfilePageProps {
  session: AppSession;
  profile: UserProfile | null;
  resume: Resume | null;
  onSave: (draft: UserProfileDraft) => void;
}

export function CareerProfilePage({
  session,
  profile,
  resume,
  onSave
}: CareerProfilePageProps) {
  return (
    <ProfileForm
      session={session}
      profile={profile}
      resume={resume}
      mode="career"
      eyebrow="Career source of truth"
      title="Maintain verified career evidence"
      description="Keep facts, skills, role strategy, and company preferences accurate. Drafts and recommendations should only lean on information you have verified."
      submitLabel="Save career profile"
      onSave={onSave}
    />
  );
}
