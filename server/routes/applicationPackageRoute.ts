import { z } from "zod";
import {
  AiProviderError,
  type AiProbeErrorCategory
} from "../ai/aiProvider";
import {
  APPLICATION_PACKAGE_PROMPT_VERSION,
  callApplicationPackageProvider,
  type ApplicationPackageHttpCall,
  type ApplicationPackagePromptInput,
  type ValidatedLlmApplicationPackageResponse
} from "../ai/applicationPackageAdapter";
import { getServerConfig, type ServerConfig, type AiProviderId } from "../config/env";
import { redactErrorForLog } from "../security/redaction";

/**
 * POST /api/ai/application-package
 *
 * Generates the LLM-driven drafts for an application package — a
 * tailored resume markdown, an optional cover letter, and short-
 * answer drafts — grounded in the candidate's resume text + verified
 * profile facts + the job description.
 *
 * Body:
 *   {
 *     job: {
 *       title: string,
 *       company: string,
 *       description: string,
 *       requirements?: string[],
 *       responsibilities?: string[]
 *     },
 *     profile: {
 *       fullName?: string,
 *       careerSummary?: string,
 *       targetTitles?: string[],
 *       targetIndustries?: string[],
 *       verifiedFacts?: string[]
 *     },
 *     resumeText?: string,
 *     questions: string[]                   // 1..10
 *     includeCoverLetter?: boolean         // default false
 *   }
 *
 * Response (200):
 *   {
 *     mode:           "llm" | "deterministic"
 *     provider:       "openai" | "azure_openai" | "deterministic"
 *     modelName:      string
 *     promptVersion:  string
 *     fallbackUsed:   boolean
 *     content: {
 *       resumeMarkdown: string
 *       coverLetter:    string
 *       answers: Array<{
 *         question:        string
 *         answer:          string
 *         confidence:      "high" | "medium" | "low"
 *         needsUserReview: boolean
 *         rationale?:      string
 *       }>
 *     }
 *   }
 *
 * Response (400) — validation error.
 * Response (500) — only if the deterministic fallback chain itself
 *                  throws (should not happen with validated input).
 *
 * Logging contract (mirrors /api/resume-intelligence):
 * - Request body is NEVER logged in full. Only structural
 *   metadata (text lengths, counts).
 * - Response body is NEVER logged.
 * - Errors pass through `redactErrorForLog`.
 */

export const applicationPackageRequestSchema = z.object({
  job: z.object({
    title: z.string().trim().min(1).max(500),
    company: z.string().trim().min(1).max(500),
    description: z.string().max(60_000).default(""),
    requirements: z.array(z.string().trim().min(1)).max(40).default([]),
    responsibilities: z.array(z.string().trim().min(1)).max(40).default([])
  }),
  profile: z
    .object({
      fullName: z.string().trim().max(500).default(""),
      careerSummary: z.string().trim().max(4_000).default(""),
      targetTitles: z.array(z.string().trim().min(1)).max(20).default([]),
      targetIndustries: z.array(z.string().trim().min(1)).max(20).default([]),
      verifiedFacts: z.array(z.string().trim().min(1)).max(60).default([])
    })
    .default({
      fullName: "",
      careerSummary: "",
      targetTitles: [],
      targetIndustries: [],
      verifiedFacts: []
    }),
  resumeText: z.string().max(200_000).default(""),
  // .min(0) so the client can request resume + cover letter
  // generation without paying for short-answer drafting (the user
  // hasn't opted in OR every question already has a saved-library
  // hit). The route still requires at least the job + profile so the
  // resume markdown is grounded.
  questions: z.array(z.string().trim().min(1)).max(10).default([]),
  includeCoverLetter: z.boolean().default(false)
});

export type ApplicationPackageRequest = z.infer<
  typeof applicationPackageRequestSchema
>;

export interface ApplicationPackageResponseAnswer {
  question: string;
  answer: string;
  confidence: "high" | "medium" | "low";
  needsUserReview: boolean;
  rationale?: string;
}

export interface ApplicationPackageResponseBody {
  mode: "llm" | "deterministic";
  provider: AiProviderId;
  modelName: string;
  promptVersion: string;
  fallbackUsed: boolean;
  content: {
    resumeMarkdown: string;
    coverLetter: string;
    answers: ApplicationPackageResponseAnswer[];
  };
}

export interface RouteLogEntry {
  level: "info" | "warn";
  message: string;
  fields: Record<string, string | number | boolean>;
}

export interface ApplicationPackageRouteResult {
  status: number;
  body:
    | ApplicationPackageResponseBody
    | { error: string; details?: unknown };
  logs: RouteLogEntry[];
}

export interface HandleApplicationPackageOptions {
  /** Inject a custom config (for tests). */
  config?: ServerConfig;
  /** Inject a fake provider HTTP call (for tests). */
  callProvider?: typeof callApplicationPackageProvider;
}

/**
 * Compute the HTTP call descriptor for the configured provider, or
 * return null when the provider is "deterministic" or not fully
 * configured. The route handler treats null as "skip LLM, go
 * straight to deterministic fallback".
 */
function resolveProviderCall(
  config: ServerConfig
): ApplicationPackageHttpCall | null {
  if (config.aiProvider === "openai") {
    if (!config.openai.apiKey || config.openai.apiKey.trim().length === 0) {
      return null;
    }
    return {
      provider: "openai",
      model: config.openai.jobModel,
      modelName: `openai:${config.openai.jobModel}`,
      endpoint: "https://api.openai.com/v1/chat/completions",
      headers: { Authorization: `Bearer ${config.openai.apiKey}` },
      includeModelInBody: true
    };
  }
  if (config.aiProvider === "azure_openai") {
    const azure = config.azureOpenai;
    if (
      azure.apiKey.trim().length === 0 ||
      azure.endpoint.trim().length === 0 ||
      azure.jobDeployment.trim().length === 0
    ) {
      return null;
    }
    const endpoint = `${azure.endpoint.replace(/\/+$/, "")}/openai/deployments/${encodeURIComponent(
      azure.jobDeployment
    )}/chat/completions?api-version=${encodeURIComponent(azure.apiVersion)}`;
    return {
      provider: "azure_openai",
      model: azure.jobDeployment,
      modelName: `azure_openai:${azure.jobDeployment}`,
      endpoint,
      headers: { "api-key": azure.apiKey },
      includeModelInBody: false
    };
  }
  return null;
}

const DETERMINISTIC_MODEL_NAME = "deterministic-package-fallback";

/**
 * Last-resort generator: a per-question deterministic bullet that
 * mirrors the existing client-side deterministic generator's tone.
 * This runs ONLY when the LLM call fails; the route never returns
 * an error to the client for transient provider issues.
 */
function buildDeterministicResponse(
  input: ApplicationPackagePromptInput
): ValidatedLlmApplicationPackageResponse {
  const verifiedSummary =
    input.verifiedFacts.length > 0
      ? input.verifiedFacts.slice(0, 2).join("; ")
      : "my profile needs more verified experience details before final submission";

  const resumeMarkdown = [
    `# ${input.candidateName || "Candidate"}`,
    "",
    "## Target Role",
    `${input.jobTitle} at ${input.company}`,
    "",
    "## Professional Summary",
    input.careerSummary ||
      "Candidate profile is incomplete; add verified experience before finalizing.",
    "",
    "## Relevant Verified Experience",
    input.verifiedFacts.length > 0
      ? input.verifiedFacts.map((fact) => `- ${fact}`).join("\n")
      : "- Add verified facts before finalizing this section.",
    "",
    "## Role Alignment",
    input.jobRequirements.length > 0
      ? input.jobRequirements
          .slice(0, 4)
          .map((need) => `- Emphasize verified evidence related to: ${need}`)
          .join("\n")
      : "- Job description has limited requirements; keep claims broad and truthful."
  ].join("\n");

  const coverLetter = input.includeCoverLetter
    ? [
        "Dear hiring team,",
        "",
        `I am interested in the ${input.jobTitle} role at ${input.company}.`,
        input.verifiedFacts.length > 0
          ? `My background includes ${verifiedSummary}.`
          : "My profile needs more verified experience details before this letter is ready to send.",
        "",
        "Thank you for your consideration."
      ].join("\n")
    : "";

  const answers = input.questions.map((question) => ({
    question,
    answer: `Based on the available verified facts: ${verifiedSummary}. This deterministic draft was generated because the AI provider was unavailable; please review carefully before submission.`,
    confidence: "low" as const,
    needs_user_review: true,
    rationale: "Deterministic fallback (LLM unavailable)"
  }));

  return { resumeMarkdown, coverLetter, answers };
}

function categoriseProviderError(
  error: AiProviderError
): AiProbeErrorCategory {
  const message = error.message.toLowerCase();
  if (message.includes("timed out")) return "timeout";
  if (message.includes("network")) return "network";
  if (message.includes("schema validation")) return "json_parse";
  if (message.includes("non-json")) return "json_parse";
  if (message.includes("not valid json")) return "json_parse";
  if (message.includes("returned http 5")) return "http_5xx";
  if (message.includes("returned http 4")) return "http_4xx";
  if (message.includes("returned http")) return "unknown";
  return "unknown";
}

function buildPromptInput(
  validated: ApplicationPackageRequest
): ApplicationPackagePromptInput {
  return {
    jobTitle: validated.job.title,
    company: validated.job.company,
    jobDescription: validated.job.description,
    jobRequirements: validated.job.requirements,
    jobResponsibilities: validated.job.responsibilities,
    candidateName: validated.profile.fullName,
    careerSummary: validated.profile.careerSummary,
    targetTitles: validated.profile.targetTitles,
    targetIndustries: validated.profile.targetIndustries,
    verifiedFacts: validated.profile.verifiedFacts,
    resumeText: validated.resumeText,
    questions: validated.questions,
    includeCoverLetter: validated.includeCoverLetter
  };
}

/**
 * Pure handler. Takes a parsed (untyped) JSON body, returns the
 * status + body the HTTP layer should send, plus a list of
 * structural log entries the HTTP layer should emit.
 */
export async function handleApplicationPackage(
  rawBody: unknown,
  options: HandleApplicationPackageOptions = {}
): Promise<ApplicationPackageRouteResult> {
  const validation = applicationPackageRequestSchema.safeParse(rawBody);
  if (!validation.success) {
    return {
      status: 400,
      body: {
        error: "Invalid request body",
        details: validation.error.issues.slice(0, 3).map((issue) => ({
          path: issue.path.join("."),
          message: issue.message
        }))
      },
      logs: [
        {
          level: "warn",
          message: "application_package.validation_failed",
          fields: { issueCount: validation.error.issues.length }
        }
      ]
    };
  }

  const input = validation.data;
  const config = options.config ?? getServerConfig();
  const callProvider = options.callProvider ?? callApplicationPackageProvider;
  const promptInput = buildPromptInput(input);

  const baseFields: Record<string, string | number | boolean> = {
    jobTitleLen: input.job.title.length,
    companyLen: input.job.company.length,
    descLen: input.job.description.length,
    reqsCount: input.job.requirements.length,
    respCount: input.job.responsibilities.length,
    questionsCount: input.questions.length,
    resumeTextLen: input.resumeText.length,
    verifiedFactsCount: input.profile.verifiedFacts.length,
    includeCoverLetter: input.includeCoverLetter,
    aiProvider: config.aiProvider
  };

  const providerCall = resolveProviderCall(config);
  if (!providerCall) {
    // No LLM provider configured (or missing key) — deterministic
    // fallback only. Return 200 with mode="deterministic".
    const deterministic = buildDeterministicResponse(promptInput);
    return {
      status: 200,
      body: {
        mode: "deterministic",
        provider: "deterministic",
        modelName: DETERMINISTIC_MODEL_NAME,
        promptVersion: APPLICATION_PACKAGE_PROMPT_VERSION,
        fallbackUsed: true,
        content: mapToResponseContent(deterministic)
      },
      logs: [
        {
          level: "info",
          message: "application_package.no_llm_configured",
          fields: baseFields
        }
      ]
    };
  }

  try {
    const result = await callProvider(providerCall, promptInput);
    return {
      status: 200,
      body: {
        mode: "llm",
        provider: result.provider,
        modelName: result.modelName,
        promptVersion: result.promptVersion,
        fallbackUsed: false,
        content: mapToResponseContent(result.output)
      },
      logs: [
        {
          level: "info",
          message: "application_package.generated",
          fields: {
            ...baseFields,
            usedProvider: result.provider,
            modelName: result.modelName,
            answersCount: result.output.answers.length
          }
        }
      ]
    };
  } catch (cause) {
    const redacted = redactErrorForLog(cause);
    const errorCategory =
      cause instanceof AiProviderError
        ? categoriseProviderError(cause)
        : ("unknown" as AiProbeErrorCategory);
    const primaryLog: RouteLogEntry = {
      level: "warn",
      message: "application_package.primary_failed",
      fields: {
        ...baseFields,
        errorName: redacted.name,
        errorMessage: redacted.message,
        errorCategory
      }
    };
    // LLM failed — fall back to deterministic. The fallback never
    // throws for any input that passed Zod validation.
    const deterministic = buildDeterministicResponse(promptInput);
    return {
      status: 200,
      body: {
        mode: "deterministic",
        provider: "deterministic",
        modelName: DETERMINISTIC_MODEL_NAME,
        promptVersion: APPLICATION_PACKAGE_PROMPT_VERSION,
        fallbackUsed: true,
        content: mapToResponseContent(deterministic)
      },
      logs: [
        primaryLog,
        {
          level: "info",
          message: "application_package.deterministic_fallback",
          fields: { ...baseFields, errorCategory }
        }
      ]
    };
  }
}

function mapToResponseContent(
  llm: ValidatedLlmApplicationPackageResponse
): ApplicationPackageResponseBody["content"] {
  return {
    resumeMarkdown: llm.resumeMarkdown,
    coverLetter: llm.coverLetter,
    answers: llm.answers.map((answer) => ({
      question: answer.question,
      answer: answer.answer,
      confidence: answer.confidence,
      needsUserReview: answer.needs_user_review,
      rationale: answer.rationale && answer.rationale.length > 0
        ? answer.rationale
        : undefined
    }))
  };
}
