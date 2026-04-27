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

/**
 * Extensions whose text content can be read directly in the browser via
 * `File.text()`. PDF / DOC / DOCX need binary parsers we do not bundle in
 * the local MVP — those go through the metadata-only path with an
 * `extractionPending` signal so the UI can be honest about it.
 */
const TEXT_EXTRACTABLE_EXTENSIONS = new Set(["txt", "md"]);
const BINARY_EXTRACTION_PENDING_EXTENSIONS = new Set(["pdf", "doc", "docx"]);

const RESUME_EXTRACTION_PENDING_TEXT =
  "Resume text extraction has not run yet. Add verified facts in the career profile before using this resume for application drafts.";

export interface ParsedUploadedResume {
  /** Persisted Resume record. Caller is responsible for `saveResume`. */
  resume: Resume;
  /**
   * True when the file was a binary format we cannot parse locally
   * (pdf/doc/docx). The Resume's parsedText is a placeholder and the
   * UI should surface "text extraction pending" instead of pretending
   * the resume is fully ingested.
   */
  extractionPending: boolean;
  /** Lower-cased file extension actually used (without the leading dot). */
  extension: string;
}

export class UnsupportedResumeFileError extends Error {
  constructor(
    public readonly extension: string,
    public readonly fileName: string
  ) {
    super(
      `Unsupported resume file type: .${extension}. Use PDF, DOC, DOCX, TXT, or MD.`
    );
    this.name = "UnsupportedResumeFileError";
  }
}

/**
 * Parse an uploaded File into a Resume record.
 *
 * - .txt / .md  → reads file text in browser via File.text() and stores
 *                  the full content as parsedText (status = "parsed").
 * - .pdf / .doc / .docx → records metadata only, stores a placeholder
 *                  parsedText, and flags extractionPending so the UI can
 *                  show "text extraction pending" honestly. status =
 *                  "uploaded" so the resume domain enum reflects that
 *                  parsing has not actually completed.
 * - anything else → throws UnsupportedResumeFileError.
 *
 * Never logs the file contents or the file object. Caller passes the
 * File directly; the function reads it via the standard web API.
 */
export async function parseUploadedResumeFile(
  session: AppSession,
  file: File
): Promise<ParsedUploadedResume> {
  const fileName = file.name.trim() || "uploaded-resume";
  const extension = fileExtension(fileName);

  if (TEXT_EXTRACTABLE_EXTENSIONS.has(extension)) {
    const text = (await file.text()).trim();
    const id = createId("resume");
    const resume: Resume = {
      id,
      tenantId: session.tenant.id,
      userId: session.userId,
      originalFileName: fileName,
      fileUrl: `local-upload://resume/${id}.${extension}`,
      parsedText: text,
      status: "parsed",
      createdAt: new Date().toISOString()
    };
    return {
      resume: resumeSchema.parse(resume),
      extractionPending: false,
      extension
    };
  }

  if (BINARY_EXTRACTION_PENDING_EXTENSIONS.has(extension)) {
    const id = createId("resume");
    const resume: Resume = {
      id,
      tenantId: session.tenant.id,
      userId: session.userId,
      originalFileName: fileName,
      fileUrl: `local-upload://resume/${id}.${extension}`,
      parsedText: RESUME_EXTRACTION_PENDING_TEXT,
      // "uploaded" (not "parsed") so the domain enum is honest: the file
      // is on disk but text has not been extracted yet.
      status: "uploaded",
      createdAt: new Date().toISOString()
    };
    return {
      resume: resumeSchema.parse(resume),
      extractionPending: true,
      extension
    };
  }

  throw new UnsupportedResumeFileError(extension, fileName);
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
