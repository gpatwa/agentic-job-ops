import { FileCheck2, FileClock } from "lucide-react";
import type { Resume } from "../models/domain";

interface ResumeStatusCardProps {
  resume: Resume | null;
}

function resumeDisplayName(resume: Resume): string {
  const normalizedName = resume.originalFileName.toLowerCase();
  return normalizedName.includes("placeholder") && normalizedName.includes("resume")
    ? "Resume record"
    : resume.originalFileName;
}

export function ResumeStatusCard({ resume }: ResumeStatusCardProps) {
  const hasResume = Boolean(resume);
  const Icon = hasResume ? FileCheck2 : FileClock;

  return (
    <div className="rounded-lg border border-line bg-white p-5 shadow-soft">
      <div className="flex items-start gap-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-teal-50 text-teal-700">
          <Icon aria-hidden="true" size={21} />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-500">Resume upload status</p>
          <h3 className="mt-1 truncate text-lg font-semibold text-slate-950">
            {resume ? resumeDisplayName(resume) : "No resume uploaded"}
          </h3>
          <p className="mt-2 text-sm text-slate-500">
            {resume
              ? "Resume record is ready. Text extraction is shown when available."
              : "Upload a resume to create the first resume record."}
          </p>
        </div>
      </div>
    </div>
  );
}
