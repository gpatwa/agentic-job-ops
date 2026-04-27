import { describe, expect, it } from "vitest";
import { createOpenAIResumeIntelligenceAdapter } from "../src/services/openaiResumeIntelligenceAdapter";
import { currentSession } from "../src/data/currentSession";
import type { Resume } from "../src/models/domain";

/**
 * Opt-in LIVE LLM test. Skipped unless BOTH of the following are
 * true:
 *   - process.env.OPENAI_API_KEY is set
 *   - process.env.RUN_LLM_TESTS === "1"
 *
 * Use `npm run test:llm` (which sets RUN_LLM_TESTS=1 and only
 * matches `*.llm.test.ts`) to invoke. Normal `npm test` and
 * `npm run qa:mvp` skip these — they cost real money and require a
 * network round-trip.
 */

const RUN_LIVE =
  process.env.RUN_LLM_TESTS === "1" &&
  typeof process.env.OPENAI_API_KEY === "string" &&
  process.env.OPENAI_API_KEY.length > 0;

const describeLive = RUN_LIVE ? describe : describe.skip;

function makeResume(text: string): Resume {
  return {
    id: "resume_live_llm",
    tenantId: currentSession.tenant.id,
    userId: currentSession.userId,
    originalFileName: "resume.txt",
    fileUrl: "local://resume.txt",
    parsedText: text,
    status: "parsed",
    createdAt: new Date().toISOString()
  };
}

const SAMPLE_RESUME = `Jane Doe
Senior Product Manager
jane.doe@example.com
+1 555-555-0100
https://www.linkedin.com/in/janedoe

Experience
Senior Product Manager — DemoLabs — 2022 - 2026
Led B2B SaaS workflow automation roadmap; partnered with engineering and design.
Shipped major roadmap; +20% activation, +12% retention.
Customer discovery interviews; led cross-functional team of 4 engineers.

Skills
Product Management, Roadmap, Customer Discovery, SQL, Figma`;

describeLive("OpenAI live resume-intelligence call (opt-in via test:llm)", () => {
  it("returns a schema-valid response that produces extractionMode=llm", async () => {
    const adapter = createOpenAIResumeIntelligenceAdapter({
      apiKey: process.env.OPENAI_API_KEY,
      model: process.env.OPENAI_RESUME_MODEL ?? "gpt-4.1-mini"
    });
    const out = await adapter.analyze({ resume: makeResume(SAMPLE_RESUME) });
    expect(out.extractionMode).toBe("llm");
    expect(out.provider).toBe("openai");
    expect(out.modelName.length).toBeGreaterThan(0);
    expect(Array.isArray(out.recommendation.strongestRoles)).toBe(true);
  }, 60_000);
});
