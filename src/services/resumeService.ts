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

function resumeVersionsKey(session: AppSession): string {
  return scopedKey(session.tenant.id, session.userId, "resume_versions");
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
  const fileName = input.fileName.trim() || "resume-record.pdf";

  const resume: Resume = {
    id,
    tenantId: session.tenant.id,
    userId: session.userId,
    originalFileName: fileName,
    fileUrl: `${input.hasLocalFile ? "local-upload" : "local-placeholder"}://resume/${id}.${fileExtension(fileName)}`,
    parsedText:
      "Resume text extraction has not run yet. Add verified facts in the career profile before using this resume for application drafts.",
    status: "parsed",
    createdAt: new Date().toISOString()
  };

  return resumeSchema.parse(resume);
}

export function createResumeFromText(
  session: AppSession,
  text: string,
  fileName = "pasted-resume.txt"
): Resume {
  const id = createId("resume");
  const trimmed = text.trim();
  const resume: Resume = {
    id,
    tenantId: session.tenant.id,
    userId: session.userId,
    originalFileName: fileName.trim() || "pasted-resume.txt",
    fileUrl: `local-paste://resume/${id}.txt`,
    parsedText: trimmed,
    status: "parsed",
    createdAt: new Date().toISOString()
  };
  return resumeSchema.parse(resume);
}

export const DEMO_RESUME_TEXT = `Jane Doe
Senior Product Manager
Remote
jane.doe@example.com
+1 555-555-0100
https://www.linkedin.com/in/janedoe
https://github.com/janedoe

Experience
Senior Product Manager — DemoLabs — 2022 - 2026
Led B2B SaaS workflow automation roadmap; partnered with engineering and design.
Shipped major roadmap; +20% activation, +12% retention.
Customer discovery interviews; led cross-functional team of 4 engineers.

Skills
Product Management, Roadmap, Customer Discovery, SQL, Figma`;

export function createDemoResume(session: AppSession): Resume {
  return createResumeFromText(
    session,
    DEMO_RESUME_TEXT,
    "demo-resume.txt"
  );
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

export function loadResumeVersions(session: AppSession): Resume[] {
  const versions = readJson<Resume[]>(resumeVersionsKey(session), []);
  return versions.filter((version) => resumeSchema.safeParse(version).success);
}

export function saveResumeVersions(
  session: AppSession,
  versions: Resume[]
): Resume[] {
  const parsed = versions.map((version) => resumeSchema.parse(version));
  writeJson(resumeVersionsKey(session), parsed.slice(0, 50));
  return parsed;
}

/**
 * Append a resume to the version history. Preserves anything already there
 * (including the original resume) and never deletes prior versions.
 */
export function addResumeVersion(
  session: AppSession,
  resume: Resume
): Resume[] {
  const existing = loadResumeVersions(session);
  if (existing.some((version) => version.id === resume.id)) {
    return existing;
  }
  return saveResumeVersions(session, [resume, ...existing]);
}

/**
 * Promote a resume to the active slot while making sure both the previous
 * active resume and the new one are recorded in version history. The
 * original is never overwritten — it stays accessible via
 * loadResumeVersions.
 */
export function promoteResumeAsActive(
  session: AppSession,
  resume: Resume
): { active: Resume; versions: Resume[] } {
  const previousActive = loadResume(session);
  let versions = loadResumeVersions(session);
  if (previousActive && !versions.some((v) => v.id === previousActive.id)) {
    versions = saveResumeVersions(session, [previousActive, ...versions]);
  }
  if (!versions.some((v) => v.id === resume.id)) {
    versions = saveResumeVersions(session, [resume, ...versions]);
  }
  const active = saveResume(session, resume);
  return { active, versions };
}
