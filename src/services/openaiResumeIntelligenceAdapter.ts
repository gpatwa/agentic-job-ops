import { z } from "zod";
import type {
  Resume,
  ResumeFieldConfidence,
  ResumeIntelligenceMode
} from "../models/domain";
import {
  atsRiskLevels,
  recommendedRoleFitLevels,
  resumeFieldConfidences,
  skillGapImportances
} from "../models/domain";
import {
  extractedResumeProfileSchema,
  recommendedRoleSchema,
  resumeFieldConfidenceMapSchema,
  resumeIntelligenceSuggestedFixSchema,
  skillGapSchema
} from "../models/schemas";
import type {
  ResumeIntelligenceAdapter,
  ResumeIntelligenceAdapterOutput
} from "./resumeIntelligenceService";

/**
 * Phase 17 — OpenAI Resume Intelligence adapter.
 *
 * Safety contract:
 * - The OpenAI API key is read at call time from `process.env.OPENAI_API_KEY`.
 *   In a browser bundle (Vite), `process` is undefined, so the adapter is
 *   never reachable from the client and the key never lands in JS sent to
 *   the user. The adapter is intended for Node contexts (vitest, scripts,
 *   future server / proxy code).
 * - The adapter never logs the raw resume text or the API key. Only IDs,
 *   lengths, model name, and structured response metadata are observable.
 * - The model is asked for JSON only (`response_format: json_object`) and
 *   the response is validated against the existing Zod schemas. If the
 *   model returns malformed JSON or output that fails validation, the
 *   adapter throws a typed `OpenAIResumeIntelligenceAdapterError` so the
 *   caller can fall back deterministically.
 * - The prompt forbids invention: no fabricated employers, titles,
 *   degrees, skills, metrics, or demographics. Weak-evidence roles must
 *   be classified as `adjacent` or `stretch`, never `strong`.
 */

/**
 * Public, stable identifier for the LLM resume-intelligence prompt.
 * Both the OpenAI provider and the server-side Azure OpenAI provider
 * use the same prompt + schema, so this version moves in lock-step
 * with both. Bump it whenever the prompt or schema changes shape.
 */
export const RESUME_INTELLIGENCE_PROMPT_VERSION =
  "resume-intelligence-openai-v1";

/** Backwards-compatible alias for the constant the file used to keep local. */
const PROMPT_VERSION = RESUME_INTELLIGENCE_PROMPT_VERSION;
const DEFAULT_MODEL = "gpt-4.1-mini";
const DEFAULT_ENDPOINT = "https://api.openai.com/v1/chat/completions";

/**
 * Strict schema for the model's JSON response. We keep the shape close to
 * `ResumeIntelligenceAdapterOutput` so we can pass through after validation
 * with minimal mapping. `extractionMode`, `modelName`, and `promptVersion`
 * are filled in by the adapter — the model does not control them.
 */
const llmResponseSchema = z.object({
  extractedProfile: extractedResumeProfileSchema,
  confidenceByField: resumeFieldConfidenceMapSchema,
  missingFields: z.array(z.string().trim().min(1)).default([]),
  ambiguousFields: z.array(z.string().trim().min(1)).default([]),
  parsingWarnings: z.array(z.string().trim().min(1)).default([]),
  atsRiskScore: z.number().min(0).max(100),
  atsRiskLevel: z.enum(atsRiskLevels),
  suggestedFixes: z.array(resumeIntelligenceSuggestedFixSchema).default([]),
  recommendation: z.object({
    strongestRoles: z.array(recommendedRoleSchema).default([]),
    adjacentRoles: z.array(recommendedRoleSchema).default([]),
    stretchRoles: z.array(recommendedRoleSchema).default([]),
    rolesToAvoid: z.array(recommendedRoleSchema).default([]),
    recommendedIndustries: z.array(z.string().trim().min(1)).default([]),
    recommendedSeniority: z.string().trim().default(""),
    recommendedSearchKeywords: z.array(z.string().trim().min(1)).default([]),
    positioningSummary: z.string().trim().default(""),
    resumePositioningAdvice: z.array(z.string().trim().min(1)).default([]),
    skillGaps: z.array(skillGapSchema).default([]),
    confidence: z.enum(resumeFieldConfidences)
  })
});

export type OpenAIResumeIntelligenceResponse = z.infer<typeof llmResponseSchema>;

/**
 * Re-exported schema for any provider that produces the same JSON
 * shape (Azure OpenAI, future Anthropic / Bedrock providers, etc.).
 */
export const llmResumeIntelligenceResponseSchema = llmResponseSchema;
export type LlmResumeIntelligenceResponse = z.infer<typeof llmResponseSchema>;

/**
 * Re-exported post-processor that converts a validated LLM response
 * into the canonical `ResumeIntelligenceAdapterOutput` (with the
 * defense-in-depth dedupe + fitLevel enforcement applied).
 */
export function mapValidatedLlmResponseToOutput(
  llm: LlmResumeIntelligenceResponse,
  model: string
): ResumeIntelligenceAdapterOutput {
  return mapLlmResponseToOutput(llm, model);
}

export class OpenAIResumeIntelligenceAdapterError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = "OpenAIResumeIntelligenceAdapterError";
  }
}

export interface OpenAIResumeIntelligenceAdapterOptions {
  /** Override the API key. Defaults to `process.env.OPENAI_API_KEY`. */
  apiKey?: string;
  /** Override the model. Defaults to `process.env.OPENAI_RESUME_MODEL` or `gpt-4.1-mini`. */
  model?: string;
  /** Override the chat completions endpoint. Test-only. */
  endpoint?: string;
  /** Inject a fetch implementation. Defaults to `globalThis.fetch`. */
  fetchImpl?: typeof fetch;
  /** Optional max tokens for the response (passed through to OpenAI). */
  maxTokens?: number;
}

/**
 * Read `process.env` defensively. In a browser bundle `process` is
 * undefined; this returns undefined and callers fall back to deterministic.
 */
function readEnv(name: string): string | undefined {
  const proc = (
    globalThis as unknown as { process?: { env?: Record<string, string | undefined> } }
  ).process;
  return proc?.env?.[name];
}

/**
 * True if the OpenAI adapter has the credentials it needs to run. In the
 * browser this is always false because `process.env` is undefined.
 */
export function openaiAdapterAvailable(
  options: Pick<OpenAIResumeIntelligenceAdapterOptions, "apiKey"> = {}
): boolean {
  const key = options.apiKey ?? readEnv("OPENAI_API_KEY");
  return Boolean(key && key.trim().length > 0);
}

/**
 * System prompt used by every LLM-backed resume-intelligence
 * provider (OpenAI, Azure OpenAI, future server-side adapters).
 * Re-exported so the Azure provider can issue the same prompt
 * without duplicating the safety contract.
 */
export const RESUME_INTELLIGENCE_SYSTEM_PROMPT = `You are a careful resume analysis assistant for a job search platform.

Hard rules:
- Use ONLY evidence present in the resume text the user provides. Do NOT
  invent employers, titles, dates, degrees, certifications, skills, tools,
  or quantified metrics. If the resume does not show a fact, omit it (or
  mark the field empty / missing / low-confidence).
- Do NOT infer or output protected demographic information (age, gender,
  race, religion, nationality, marital status, sexual orientation,
  disability, family status). If the resume mentions any such attribute,
  do not surface it in the output.
- Cite evidence snippets from the resume for each role recommendation in
  the role's evidenceFromResume field. Each snippet must be a short
  verbatim phrase that actually appears in the resume.
- Classify roles by evidence strength:
    "strong"   = multiple clear, direct evidence snippets supporting both
                 the title and the seniority on this resume.
    "adjacent" = related/transferable evidence; partial title or seniority
                 support.
    "stretch"  = weak or indirect evidence; the candidate would need to
                 reposition before applying.
    "avoid"    = no evidence at all; surface this only with a clear
                 "no evidence" reason and never as a recommended target.
  When in doubt, prefer "adjacent" or "stretch" over "strong".
- Output JSON only. No prose, no markdown. The JSON must conform to the
  schema described in the user message.`;

/** Backwards-compatible alias for the local SYSTEM_PROMPT name. */
const SYSTEM_PROMPT = RESUME_INTELLIGENCE_SYSTEM_PROMPT;

/**
 * Build the user-message portion of the resume-intelligence prompt.
 * Re-exported so the Azure provider can reuse the same instructions
 * verbatim.
 */
export function buildResumeIntelligenceUserPrompt(resumeText: string): string {
  return buildUserPrompt(resumeText);
}

function buildUserPrompt(resumeText: string): string {
  return `Analyze the following resume text and return a single JSON object with this exact shape (TypeScript-style for clarity):

{
  "extractedProfile": {
    "fullName": string, "email": string, "phone": string, "location": string,
    "linkedinUrl": string, "githubUrl": string, "portfolioUrl": string,
    "currentTitle": string, "seniorityLevel": string,
    "yearsOfExperience": number | null,
    "industries": string[], "companies": string[], "jobTitles": string[],
    "education": string[], "certifications": string[],
    "skills": string[], "tools": string[],
    "projects": string[], "leadershipExamples": string[],
    "quantifiedAchievements": string[],
    "workAuthorization": string,
    "resumeStrengths": string[], "resumeGaps": string[]
  },
  "confidenceByField": {
    "fullName": "high"|"medium"|"low", "email": "high"|"medium"|"low",
    "phone": "high"|"medium"|"low", "location": "high"|"medium"|"low",
    "linkedinUrl": "high"|"medium"|"low", "githubUrl": "high"|"medium"|"low",
    "portfolioUrl": "high"|"medium"|"low", "currentTitle": "high"|"medium"|"low",
    "seniorityLevel": "high"|"medium"|"low", "yearsOfExperience": "high"|"medium"|"low",
    "skills": "high"|"medium"|"low", "industries": "high"|"medium"|"low"
  },
  "missingFields": string[],
  "ambiguousFields": string[],
  "parsingWarnings": string[],
  "atsRiskScore": number 0..100,
  "atsRiskLevel": "low"|"medium"|"high",
  "suggestedFixes": [{"field": string, "severity": "low"|"medium"|"high",
                     "message": string, "recommendedAction": string}],
  "recommendation": {
    "strongestRoles": [{"title": string, "fitLevel": "strong"|"adjacent"|"stretch"|"avoid",
                        "confidence": "high"|"medium"|"low",
                        "why": string,
                        "evidenceFromResume": string[],
                        "searchKeywords": string[],
                        "suggestedResumeAngle": string}],
    "adjacentRoles": <same shape>,
    "stretchRoles": <same shape>,
    "rolesToAvoid": <same shape>,
    "recommendedIndustries": string[],
    "recommendedSeniority": string,
    "recommendedSearchKeywords": string[],
    "positioningSummary": string,
    "resumePositioningAdvice": string[],
    "skillGaps": [{"skill": string, "importance": ${JSON.stringify(skillGapImportances)},
                   "reason": string, "howToClose": string}],
    "confidence": "high"|"medium"|"low"
  }
}

Constraints:
- "atsRiskScore" is an integer or float between 0 and 100. Higher = more risk.
- "atsRiskLevel" must be the bucket that matches the score
  (low <25, medium 25-49, high >=50).
- For each role in strongestRoles / adjacentRoles / stretchRoles, the
  "evidenceFromResume" array must contain at least one short verbatim
  snippet from the resume. If you cannot cite evidence, do not include
  the role in strongestRoles — move it to adjacentRoles or stretchRoles.
- "fitLevel" within an array must match the array category (strongestRoles
  contains "strong", adjacentRoles contains "adjacent", etc.).
- Allowed fitLevel values: ${JSON.stringify(recommendedRoleFitLevels)}.
- Allowed confidence values: ${JSON.stringify(resumeFieldConfidences)}.
- Allowed atsRiskLevel values: ${JSON.stringify(atsRiskLevels)}.
- Do not duplicate role titles across categories.
- Do not output anything outside the JSON object.

Resume text:
"""
${resumeText}
"""`;
}

interface OpenAIChatResponse {
  choices?: Array<{
    message?: { content?: string };
  }>;
}

class OpenAIResumeIntelligenceAdapter implements ResumeIntelligenceAdapter {
  name = "openai-resume-intelligence-adapter";

  constructor(private readonly options: OpenAIResumeIntelligenceAdapterOptions = {}) {}

  async analyze(input: { resume: Resume }): Promise<ResumeIntelligenceAdapterOutput> {
    const apiKey = this.options.apiKey ?? readEnv("OPENAI_API_KEY");
    if (!apiKey || apiKey.trim().length === 0) {
      throw new OpenAIResumeIntelligenceAdapterError(
        "OPENAI_API_KEY is not configured. The OpenAI resume intelligence adapter cannot run."
      );
    }
    const model =
      this.options.model ?? readEnv("OPENAI_RESUME_MODEL") ?? DEFAULT_MODEL;
    const endpoint = this.options.endpoint ?? DEFAULT_ENDPOINT;
    const fetchImpl =
      this.options.fetchImpl ??
      (typeof fetch !== "undefined" ? fetch : undefined);
    if (!fetchImpl) {
      throw new OpenAIResumeIntelligenceAdapterError(
        "No fetch implementation available for the OpenAI adapter."
      );
    }

    const resumeText = input.resume.parsedText ?? "";
    const body = {
      model,
      temperature: 0,
      response_format: { type: "json_object" as const },
      max_tokens: this.options.maxTokens ?? 2400,
      messages: [
        { role: "system" as const, content: SYSTEM_PROMPT },
        { role: "user" as const, content: buildUserPrompt(resumeText) }
      ]
    };

    let httpResponse: Response;
    try {
      httpResponse = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          // NEVER log this header.
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
      });
    } catch (cause) {
      throw new OpenAIResumeIntelligenceAdapterError(
        "OpenAI request failed before a response was returned.",
        cause
      );
    }

    if (!httpResponse.ok) {
      // Pull text but never echo response body wholesale into errors that
      // callers might log — keep the message generic.
      throw new OpenAIResumeIntelligenceAdapterError(
        `OpenAI returned HTTP ${httpResponse.status}.`
      );
    }

    let payload: OpenAIChatResponse;
    try {
      payload = (await httpResponse.json()) as OpenAIChatResponse;
    } catch (cause) {
      throw new OpenAIResumeIntelligenceAdapterError(
        "OpenAI response was not valid JSON.",
        cause
      );
    }

    const content = payload.choices?.[0]?.message?.content;
    if (!content || typeof content !== "string") {
      throw new OpenAIResumeIntelligenceAdapterError(
        "OpenAI response was missing message content."
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch (cause) {
      throw new OpenAIResumeIntelligenceAdapterError(
        "OpenAI response content was not valid JSON.",
        cause
      );
    }

    const validation = llmResponseSchema.safeParse(parsed);
    if (!validation.success) {
      throw new OpenAIResumeIntelligenceAdapterError(
        `OpenAI response failed schema validation: ${validation.error.issues
          .slice(0, 3)
          .map((issue) => `${issue.path.join(".")}:${issue.message}`)
          .join("; ")}`
      );
    }

    const llm = validation.data;
    return mapLlmResponseToOutput(llm, model);
  }
}

export function createOpenAIResumeIntelligenceAdapter(
  options: OpenAIResumeIntelligenceAdapterOptions = {}
): ResumeIntelligenceAdapter {
  return new OpenAIResumeIntelligenceAdapter(options);
}

function mapLlmResponseToOutput(
  llm: OpenAIResumeIntelligenceResponse,
  model: string
): ResumeIntelligenceAdapterOutput {
  // Defense-in-depth: enforce fitLevel-vs-bucket consistency post-hoc so
  // even if the model slips, we never present a "strong" role inside
  // adjacent/stretch buckets (or vice versa).
  const strongest = llm.recommendation.strongestRoles
    .map((role) => normaliseRole(role, "strong"))
    .filter((role): role is NonNullable<typeof role> => role !== null);
  const adjacent = llm.recommendation.adjacentRoles
    .map((role) => normaliseRole(role, "adjacent"))
    .filter((role): role is NonNullable<typeof role> => role !== null);
  const stretch = llm.recommendation.stretchRoles
    .map((role) => normaliseRole(role, "stretch"))
    .filter((role): role is NonNullable<typeof role> => role !== null);
  const avoid = llm.recommendation.rolesToAvoid
    .map((role) => normaliseRole(role, "avoid"))
    .filter((role): role is NonNullable<typeof role> => role !== null);

  // Defense-in-depth: dedupe titles across buckets, preferring the
  // higher-confidence bucket (strong > adjacent > stretch > avoid).
  const seen = new Set<string>();
  const dedupe = (
    roles: typeof strongest
  ): typeof strongest =>
    roles.filter((role) => {
      const key = role.title.trim().toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  const dedupedStrongest = dedupe(strongest);
  const dedupedAdjacent = dedupe(adjacent);
  const dedupedStretch = dedupe(stretch);
  const dedupedAvoid = dedupe(avoid);

  return {
    modelName: model,
    promptVersion: PROMPT_VERSION,
    extractionMode: "llm" as ResumeIntelligenceMode,
    provider: "openai",
    extractedProfile: llm.extractedProfile,
    confidenceByField: llm.confidenceByField,
    missingFields: llm.missingFields,
    ambiguousFields: llm.ambiguousFields,
    parsingWarnings: llm.parsingWarnings,
    atsRiskScore: llm.atsRiskScore,
    atsRiskLevel: llm.atsRiskLevel,
    suggestedFixes: llm.suggestedFixes,
    recommendation: {
      strongestRoles: dedupedStrongest,
      adjacentRoles: dedupedAdjacent,
      stretchRoles: dedupedStretch,
      rolesToAvoid: dedupedAvoid,
      recommendedIndustries: llm.recommendation.recommendedIndustries,
      recommendedSeniority: llm.recommendation.recommendedSeniority,
      recommendedSearchKeywords: llm.recommendation.recommendedSearchKeywords,
      positioningSummary: llm.recommendation.positioningSummary,
      resumePositioningAdvice: llm.recommendation.resumePositioningAdvice,
      skillGaps: llm.recommendation.skillGaps,
      confidence: llm.recommendation.confidence
    }
  };
}

type LlmRole = z.infer<typeof recommendedRoleSchema>;
type EnforcedRole = LlmRole;

function normaliseRole(
  role: LlmRole,
  bucketFitLevel: LlmRole["fitLevel"]
): EnforcedRole | null {
  // Force the role into the bucket's fit level, even if the model
  // disagrees. This prevents a "strong" entry inside the adjacent bucket
  // from being labelled strong in the UI.
  const enforced: EnforcedRole = { ...role, fitLevel: bucketFitLevel };
  // Defense-in-depth: a "strong" recommendation MUST cite at least one
  // evidence snippet. Demote anything that doesn't.
  if (
    enforced.fitLevel === "strong" &&
    enforced.evidenceFromResume.length === 0
  ) {
    return { ...enforced, fitLevel: "adjacent", confidence: weakest(enforced.confidence) };
  }
  return enforced;
}

function weakest(value: ResumeFieldConfidence): ResumeFieldConfidence {
  if (value === "high") return "medium";
  if (value === "medium") return "low";
  return "low";
}

/**
 * Convenience: pick the OpenAI adapter when configured, else null. The
 * service uses this to default-select an adapter without forcing callers
 * to read env themselves.
 */
export function pickOpenAIAdapterIfConfigured(
  options: OpenAIResumeIntelligenceAdapterOptions = {}
): ResumeIntelligenceAdapter | null {
  if (!openaiAdapterAvailable(options)) return null;
  return createOpenAIResumeIntelligenceAdapter(options);
}
