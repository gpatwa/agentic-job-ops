import { z } from "zod";
import { redactErrorForLog } from "../security/redaction";
import type { AiProviderId } from "../config/env";
import { AiProviderError } from "./aiProvider";

/**
 * Server-side LLM application-package generator.
 *
 * Two-call surface (OpenAI public + Azure OpenAI) sharing one
 * adapter because the request body is identical — only the URL +
 * auth header + whether to include the `model` field differ. We
 * encode that difference at the call site and keep prompt / schema
 * / response mapping in one place.
 *
 * Safety contract:
 * - The API key is read from server config and NEVER appears in any
 *   log line, error message, or response body.
 * - The resume text, profile, and job description are NEVER logged
 *   in full. Only structural metadata (lengths, counts) is emitted.
 * - On any failure (missing key, non-2xx, invalid JSON, schema
 *   validation), the caller throws `AiProviderError` and the route
 *   layer falls back to the deterministic generator so a transient
 *   provider outage never blocks the user from previewing a draft.
 * - The system prompt is strict: invent NOTHING, ground every claim
 *   in the supplied resume / profile / job text, mark uncertain
 *   answers as needing review.
 */

export const APPLICATION_PACKAGE_PROMPT_VERSION = "application-package-llm-v1";

const APPLICATION_PACKAGE_TIMEOUT_MS = 60_000;
const APPLICATION_PACKAGE_MAX_TOKENS = 4_000;

export const APPLICATION_PACKAGE_SYSTEM_PROMPT = `You are an application-package draft generator for a job-application platform.

Hard rules — violating ANY of these is a critical failure:
- INVENT NOTHING. Every concrete claim (employer, tool, metric, certification, school) must appear in the candidate's resume text or verified facts. If the source is silent, write a generic, true sentence and mark the answer with "needs_user_review": true.
- NEVER fabricate quantified outcomes. Use numbers ONLY if they appear verbatim in the resume text or verified facts.
- NEVER fabricate company names, schools, certifications, or tools. Mention only what the source supports.
- Match the role being applied to. Reference the job's title, company, and 1-2 specific requirements from the description.
- Keep tone professional, concise, in first person, no clichés ("rockstar", "ninja", "passionate"), no buzzword salads.
- Each short answer is 80-180 words. Cover letter is 180-280 words. Resume markdown is structured Markdown with sections.
- Output strictly valid JSON matching the requested schema. No prose outside the JSON object.`;

export interface ApplicationPackagePromptInput {
  jobTitle: string;
  company: string;
  jobDescription: string;
  jobRequirements: string[];
  jobResponsibilities: string[];
  candidateName: string;
  careerSummary: string;
  targetTitles: string[];
  targetIndustries: string[];
  verifiedFacts: string[];
  /** The candidate's resume parsed text (may be empty). */
  resumeText: string;
  /** Specific short-answer questions to draft. */
  questions: string[];
  /** When false, omit the cover letter from the response (return ""). */
  includeCoverLetter: boolean;
}

export function buildApplicationPackageUserPrompt(
  input: ApplicationPackagePromptInput
): string {
  const lines: string[] = [];
  lines.push("# Job");
  lines.push(`Title: ${input.jobTitle}`);
  lines.push(`Company: ${input.company}`);
  if (input.jobRequirements.length > 0) {
    lines.push("Requirements:");
    for (const item of input.jobRequirements.slice(0, 12)) {
      lines.push(`- ${item}`);
    }
  }
  if (input.jobResponsibilities.length > 0) {
    lines.push("Responsibilities:");
    for (const item of input.jobResponsibilities.slice(0, 12)) {
      lines.push(`- ${item}`);
    }
  }
  lines.push("Job description (verbatim, may include extra noise):");
  lines.push(input.jobDescription.slice(0, 4_000));

  lines.push("");
  lines.push("# Candidate");
  lines.push(`Name: ${input.candidateName || "(not provided)"}`);
  if (input.careerSummary) {
    lines.push(`Career summary: ${input.careerSummary}`);
  }
  if (input.targetTitles.length > 0) {
    lines.push(`Target titles: ${input.targetTitles.join(", ")}`);
  }
  if (input.targetIndustries.length > 0) {
    lines.push(`Target industries: ${input.targetIndustries.join(", ")}`);
  }
  if (input.verifiedFacts.length > 0) {
    lines.push("Verified facts (treat as ground truth):");
    for (const fact of input.verifiedFacts.slice(0, 30)) {
      lines.push(`- ${fact}`);
    }
  }
  if (input.resumeText.trim().length > 0) {
    lines.push("Resume text (use as evidence; ground every claim in this):");
    lines.push(input.resumeText.slice(0, 12_000));
  } else {
    lines.push(
      "Resume text: (empty — keep claims especially conservative; mark every answer as needs_user_review)"
    );
  }

  lines.push("");
  lines.push("# Output");
  lines.push("Generate a JSON object with these keys:");
  lines.push(
    `- "resumeMarkdown": tailored resume in Markdown, sections like # ${input.candidateName || "Name"}, ## Target Role, ## Professional Summary, ## Relevant Experience, ## Role Alignment. Use ONLY facts from the resume / verified facts above. Do not list companies, tools, or metrics not present in the source.`
  );
  if (input.includeCoverLetter) {
    lines.push(
      `- "coverLetter": 180-280 word cover letter addressed "Dear hiring team,". Reference the job title and 1-2 specific requirements. Ground experience claims in the resume.`
    );
  } else {
    lines.push(
      `- "coverLetter": empty string "". The user opted out of a cover letter for this application.`
    );
  }
  if (input.questions.length > 0) {
    lines.push(
      `- "answers": array of objects, one per question below, in the same order. Each object has { "question": <verbatim question>, "answer": <80-180 word draft>, "confidence": "high" | "medium" | "low", "needs_user_review": boolean, "rationale": <1-sentence note describing what supported the answer or what gaps remain> }.`
    );
    lines.push("Questions to draft answers for:");
    input.questions.forEach((question, index) => {
      lines.push(`${index + 1}. ${question}`);
    });
    lines.push("");
    lines.push(
      'confidence rubric: "high" only when the resume text clearly supports the claims; "medium" when the answer is generic-but-true; "low" when the resume / profile is too sparse to answer well — set needs_user_review=true.'
    );
  } else {
    // Caller opted out of short-answer drafting OR every question
    // already has a SavedApplicationAnswer library hit. Spending LLM
    // tokens here is wasteful — instruct the model to return an
    // empty array so the response schema is still valid.
    lines.push(
      `- "answers": empty array []. The user did not request short-answer drafts for this application.`
    );
  }

  return lines.join("\n");
}

const answerConfidenceSchema = z.enum(["high", "medium", "low"]);

export const llmApplicationPackageResponseSchema = z.object({
  resumeMarkdown: z.string().min(1),
  coverLetter: z.string().default(""),
  // .min(0) so the model can return [] when the caller opted out
  // of short-answer drafting OR every question had a saved-library
  // hit. Resume + cover letter are still produced.
  answers: z
    .array(
      z.object({
        question: z.string().trim().min(1),
        answer: z.string().trim().min(1),
        confidence: answerConfidenceSchema,
        needs_user_review: z.boolean(),
        rationale: z.string().trim().optional().default("")
      })
    )
    .default([])
});

export type ValidatedLlmApplicationPackageResponse = z.infer<
  typeof llmApplicationPackageResponseSchema
>;

export interface ApplicationPackageHttpCall {
  /** Provider tag for logging + result. */
  provider: AiProviderId;
  /** Display name reported back to the client (e.g. "openai:gpt-4.1-mini"). */
  modelName: string;
  /** Fully-qualified endpoint URL. */
  endpoint: string;
  /** Headers to send (must include auth). */
  headers: Record<string, string>;
  /** True for OpenAI public (model goes in body). False for Azure (model in URL). */
  includeModelInBody: boolean;
  /** Model identifier (used when `includeModelInBody`). */
  model: string;
}

export interface GenerateApplicationPackageResult {
  output: ValidatedLlmApplicationPackageResponse;
  provider: AiProviderId;
  modelName: string;
  promptVersion: string;
}

/**
 * Issue the chat-completion call to either OpenAI public or Azure
 * OpenAI. The two backends have IDENTICAL request bodies (Azure
 * just omits `model`); the difference is the URL + auth header,
 * captured in `ApplicationPackageHttpCall`.
 *
 * Throws `AiProviderError` on every failure. Never logs the API
 * key, the resume text, the user prompt, or the raw response body.
 */
export async function callApplicationPackageProvider(
  call: ApplicationPackageHttpCall,
  input: ApplicationPackagePromptInput
): Promise<GenerateApplicationPackageResult> {
  const userPrompt = buildApplicationPackageUserPrompt(input);
  const body: Record<string, unknown> = {
    temperature: 0.4,
    response_format: { type: "json_object" as const },
    max_completion_tokens: APPLICATION_PACKAGE_MAX_TOKENS,
    messages: [
      { role: "system" as const, content: APPLICATION_PACKAGE_SYSTEM_PROMPT },
      { role: "user" as const, content: userPrompt }
    ]
  };
  if (call.includeModelInBody) {
    body.model = call.model;
  }

  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    APPLICATION_PACKAGE_TIMEOUT_MS
  );

  let response: Response;
  try {
    response = await fetch(call.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...call.headers },
      body: JSON.stringify(body),
      signal: controller.signal
    });
  } catch (cause) {
    clearTimeout(timer);
    const aborted =
      cause instanceof Error &&
      (cause.name === "AbortError" || cause.message.includes("aborted"));
    throw new AiProviderError(
      aborted
        ? "Application-package call timed out"
        : "Application-package network call failed",
      call.provider,
      cause
    );
  }
  clearTimeout(timer);

  if (!response.ok) {
    // Truncate + redact response text in case it contains anything
    // sensitive. Never include in the customer-visible error.
    let detail = `HTTP ${response.status}`;
    try {
      const text = await response.text();
      detail = `HTTP ${response.status}: ${
        redactErrorForLog(new Error(text.slice(0, 240))).message
      }`;
    } catch {
      /* keep generic detail */
    }
    throw new AiProviderError(
      `Application-package provider returned ${detail}`,
      call.provider
    );
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new AiProviderError(
      "Application-package provider returned non-JSON body",
      call.provider
    );
  }

  // OpenAI / Azure chat-completion shape: choices[0].message.content
  // is a JSON string we must parse a second time.
  const content =
    (payload as {
      choices?: Array<{ message?: { content?: string } }>;
    })?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || content.trim().length === 0) {
    throw new AiProviderError(
      "Application-package provider returned an empty completion",
      call.provider
    );
  }

  let parsedContent: unknown;
  try {
    parsedContent = JSON.parse(content);
  } catch {
    throw new AiProviderError(
      "Application-package completion was not valid JSON",
      call.provider
    );
  }

  const validation = llmApplicationPackageResponseSchema.safeParse(parsedContent);
  if (!validation.success) {
    throw new AiProviderError(
      "Application-package completion failed schema validation",
      call.provider
    );
  }

  return {
    output: validation.data,
    provider: call.provider,
    modelName: call.modelName,
    promptVersion: APPLICATION_PACKAGE_PROMPT_VERSION
  };
}
