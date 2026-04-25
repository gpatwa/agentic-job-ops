import { FileText, FileUp, Sparkles } from "lucide-react";
import { FormEvent, useState } from "react";
import type { Resume } from "../models/domain";
import { ResumeStatusCard } from "../components/ResumeStatusCard";

interface ResumeUploadPageProps {
  resume: Resume | null;
  onUpload: (file: File) => void;
  onPlaceholderUpload: () => void;
}

export function ResumeUploadPage({
  resume,
  onUpload,
  onPlaceholderUpload
}: ResumeUploadPageProps) {
  const [file, setFile] = useState<File | null>(null);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (file) {
      onUpload(file);
      setFile(null);
    }
  }

  return (
    <div className="space-y-6">
      <header className="max-w-3xl">
        <p className="text-sm font-semibold uppercase tracking-wide text-emerald-700">
          Resume
        </p>
        <h2 className="mt-2 text-3xl font-semibold text-slate-950">
          Upload resume
        </h2>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          Phase 1 stores upload metadata locally and shows the parser placeholder.
        </p>
      </header>

      <section className="grid gap-5 xl:grid-cols-[1fr_0.9fr]">
        <form
          className="rounded-lg border border-line bg-white p-5 shadow-soft"
          onSubmit={handleSubmit}
        >
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-md bg-teal-50 text-teal-700">
              <FileUp aria-hidden="true" size={24} />
            </div>
            <div>
              <h3 className="text-base font-semibold text-slate-950">
                Add resume file
              </h3>
              <p className="mt-1 text-sm text-slate-500">
                Accepted by the placeholder flow: PDF, DOC, DOCX, or TXT.
              </p>
            </div>
          </div>

          <label className="mt-6 flex min-h-44 cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 bg-panel px-4 text-center transition hover:border-emerald-500">
            <FileText className="text-slate-500" aria-hidden="true" size={30} />
            <span className="mt-3 text-sm font-semibold text-slate-800">
              {file ? file.name : "Choose a resume file"}
            </span>
            <span className="mt-1 text-xs text-slate-500">
              File content is not parsed in Phase 1.
            </span>
            <input
              className="sr-only"
              type="file"
              accept=".pdf,.doc,.docx,.txt"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
          </label>

          <div className="mt-5 flex flex-col gap-3 sm:flex-row">
            <button
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-ink px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-400"
              type="submit"
              disabled={!file}
            >
              <FileUp aria-hidden="true" size={18} />
              Upload resume
            </button>
            <button
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-slate-300 px-4 text-sm font-semibold text-slate-800 transition hover:bg-slate-50"
              type="button"
              onClick={onPlaceholderUpload}
            >
              <Sparkles aria-hidden="true" size={18} />
              Use placeholder
            </button>
          </div>
        </form>

        <ResumeStatusCard resume={resume} />
      </section>

      {resume && (
        <section className="rounded-lg border border-line bg-white p-5 shadow-soft">
          <h3 className="text-base font-semibold text-slate-950">
            Parsed resume text
          </h3>
          <p className="mt-3 rounded-md border border-slate-200 bg-panel p-4 text-sm leading-6 text-slate-600">
            {resume.parsedText}
          </p>
        </section>
      )}
    </div>
  );
}
