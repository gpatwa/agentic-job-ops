import { z } from "zod";
import type {
  GeneratedAnswerDraft,
  GeneratedApplicationPackageContent,
  ApplicationPackageGenerationRequest,
  ApplicationPackageGenerator
} from "./applicationPackage";
import type { GenerationMode, AnswerConfidence } from "../models/domain";

/**
 * Browser → /api/ai/application-package adapter.
 *
 * Implements ApplicationPackageGenerator. Returns the LLM-grounded
 * drafts when the route succeeds (mode === "llm"), or a deterministic
 * server-built draft when the route falls back (mode === "deterministic"
 * with fallbackUsed === true). The route ALWAYS responds 200 for any
 * input that passes its Zod schema, so this adapter never throws on a
 * transient provider outage — it just surfaces `mode === "deterministic"`
 * to the caller, who in turn renders that mode in the package metadata
 * panel.
 *
 * Safety:
 * - Never logs request/response bodies.
 * - Aborts after 60 s per call (matches server-side budget).
 * - 4xx response from the route → throws so the caller can fall back
 *   to the LOCAL deterministic generator (handles the "API server is
 *   down entirely" case).
 */

const APPLICATION_PACKAGE_API_PATH = "/api/ai/application-package";
const DEFAULT_TIMEOUT_MS = 60_000;

const responseSchema = z.object({
  mode: z.enum(["llm", "deterministic"]),
  provider: z.enum(["openai", "azure_openai", "deterministic"]),
  modelName: z.string().min(1),
  promptVersion: z.string().min(1),
  fallbackUsed: z.boolean(),
  content: z.object({
    resumeMarkdown: z.string(),
    coverLetter: z.string(),
    answers: z.array(
      z.object({
        question: z.string().min(1),
        answer: z.string().min(1),
        confidence: z.enum(["high", "medium", "low"]),
        needsUserReview: z.boolean(),
        rationale: z.string().optional()
      })
    )
  })
});

export class ApiBackedApplicationPackageError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "ApiBackedApplicationPackageError";
  }
}

export interface ApiBackedApplicationPackageOptions {
  /** Override the API base URL (tests). Defaults to VITE_API_BASE_URL or "". */
  apiBaseUrl?: string;
  /** Override the fetch impl (tests). */
  fetcher?: typeof fetch;
  /** Override the timeout (tests). */
  timeoutMs?: number;
  /** When true, request a cover letter from the model. */
  includeCoverLetter?: boolean;
}

function readApiBaseUrl(): string {
  // Vite injects environment variables at build time. We can't import
  // `import.meta.env` safely from a non-Vite test runner, so we tolerate
  // both shapes and fall back to "" (same-origin) when neither resolves.
  try {
    const meta = import.meta as unknown as {
      env?: { VITE_API_BASE_URL?: string };
    };
    return meta.env?.VITE_API_BASE_URL ?? "";
  } catch {
    return "";
  }
}

/**
 * Convert the route's strict-typed answers into the loose
 * GeneratedAnswerDraft shape the package generator expects.
 */
function mapAnswersToDrafts(
  answers: z.infer<typeof responseSchema>["content"]["answers"]
): GeneratedAnswerDraft[] {
  return answers.map((answer) => ({
    question: answer.question,
    answer: answer.answer,
    confidence: answer.confidence as AnswerConfidence,
    needsUserReview: answer.needsUserReview
  }));
}

export class ApiBackedApplicationPackageGenerator
  implements ApplicationPackageGenerator
{
  // Mode + modelName are reported AFTER each call resolves; they
  // start as "llm" because that's the intent — the result struct
  // overrides them per call.
  mode: GenerationMode = "llm";
  modelName = "api-backed-application-package";

  constructor(private readonly options: ApiBackedApplicationPackageOptions = {}) {}

  async generate(
    request: ApplicationPackageGenerationRequest
  ): Promise<GeneratedApplicationPackageContent> {
    const fetcher = this.options.fetcher ?? fetch;
    const timeoutMs = this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const baseUrl = this.options.apiBaseUrl ?? readApiBaseUrl();
    const url = `${baseUrl}${APPLICATION_PACKAGE_API_PATH}`;

    // Use the questions list the orchestrator computed (already
     // filtered to remove SavedApplicationAnswer hits) so the LLM
     // only spends tokens on questions we don't already have a
     // canonical answer for. An empty array means "skip short-answer
     // drafting entirely" — the route still generates resume +
     // optional cover letter.
    const questions = request.questions ?? [];
    const includeCoverLetter = request.includeCoverLetter ?? this.options.includeCoverLetter ?? false;

    const body = {
      job: {
        title: request.job.title,
        company: request.job.company,
        description: request.job.description ?? "",
        requirements: request.job.requirements ?? [],
        responsibilities: request.job.responsibilities ?? []
      },
      profile: {
        fullName: request.profile?.fullName ?? "",
        careerSummary: request.profile?.careerSummary ?? "",
        targetTitles: request.profile?.targetTitles ?? [],
        targetIndustries: request.profile?.targetIndustries ?? [],
        verifiedFacts: request.profile?.verifiedFacts ?? []
      },
      resumeText: request.resume?.parsedText ?? "",
      questions,
      includeCoverLetter
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetcher(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal
      });
    } catch (cause) {
      clearTimeout(timer);
      const aborted =
        cause instanceof DOMException && cause.name === "AbortError";
      throw new ApiBackedApplicationPackageError(
        aborted
          ? "Application-package call timed out"
          : "Application-package network call failed",
        cause
      );
    }
    clearTimeout(timer);

    if (!response.ok) {
      throw new ApiBackedApplicationPackageError(
        `Application-package route returned HTTP ${response.status}`
      );
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (cause) {
      throw new ApiBackedApplicationPackageError(
        "Application-package route returned non-JSON body",
        cause
      );
    }

    const validation = responseSchema.safeParse(payload);
    if (!validation.success) {
      throw new ApiBackedApplicationPackageError(
        "Application-package route returned an unexpected shape"
      );
    }

    // Mutating the per-call mode + modelName so the result struct
    // (returned just below) carries accurate provider info.
    const data = validation.data;
    this.mode = data.mode;
    this.modelName = data.modelName;

    return {
      resumeMarkdown: data.content.resumeMarkdown,
      coverLetter: data.content.coverLetter,
      answers: mapAnswersToDrafts(data.content.answers),
      generationMode: data.mode,
      modelName: data.modelName,
      promptVersion: data.promptVersion
    };
  }
}

export function createApiBackedApplicationPackageGenerator(
  options: ApiBackedApplicationPackageOptions = {}
): ApplicationPackageGenerator {
  return new ApiBackedApplicationPackageGenerator(options);
}
