import type { AppSession, Resume } from "../models/domain";
import { resumeSchema } from "../models/schemas";
import { readJson, scopedKey, writeJson } from "../lib/storage";

interface ResumeUploadInput {
  fileName: string;
  fileType?: string;
  hasLocalFile: boolean;
}

function createId(prefix: string): string {
  return `${prefix}_${globalThis.crypto.randomUUID()}`;
}

function resumeKey(session: AppSession): string {
  return scopedKey(session.tenant.id, session.userId, "resume");
}

function fileExtension(fileName: string): string {
  const pieces = fileName.split(".");
  return pieces.length > 1 ? pieces[pieces.length - 1].toLowerCase() : "unknown";
}

export function createResumeUpload(
  session: AppSession,
  input: ResumeUploadInput
): Resume {
  const id = createId("resume");
  const fileName = input.fileName.trim() || "placeholder-resume.pdf";

  const resume: Resume = {
    id,
    tenantId: session.tenant.id,
    userId: session.userId,
    originalFileName: fileName,
    fileUrl: `${input.hasLocalFile ? "local-upload" : "local-placeholder"}://resume/${id}.${fileExtension(fileName)}`,
    parsedText:
      "Resume parsing placeholder: Phase 1 stores the upload record and reserves this field for a parser service. No resume content has been extracted yet.",
    status: "parsed",
    createdAt: new Date().toISOString()
  };

  return resumeSchema.parse(resume);
}

export function loadResume(session: AppSession): Resume | null {
  const resume = readJson<Resume | null>(resumeKey(session), null);
  if (!resume) {
    return null;
  }

  const parsed = resumeSchema.safeParse(resume);
  return parsed.success ? parsed.data : null;
}

export function saveResume(session: AppSession, resume: Resume): Resume {
  const parsed = resumeSchema.parse(resume);
  writeJson(resumeKey(session), parsed);
  return parsed;
}
