import { describe, expect, it } from "vitest";
import { currentSession } from "../src/data/currentSession";
import type { Resume } from "../src/models/domain";
import {
  RESUME_EXTRACTION_PENDING_PREFIX,
  assessResumeTextQuality,
  canRunResumeIntelligence,
  describeResumeQualityForCustomer
} from "../src/services/resumeTextQuality";

function makeResume(
  text: string,
  overrides: Partial<Resume> = {}
): Resume {
  return {
    id: "resume_quality_test",
    tenantId: currentSession.tenant.id,
    userId: currentSession.userId,
    originalFileName: "resume.txt",
    fileUrl: "local-upload://resume/x.txt",
    parsedText: text,
    status: "parsed",
    createdAt: new Date().toISOString(),
    ...overrides
  };
}

const RICH_RESUME = `Jane Doe
Senior Product Manager
Remote
jane.doe@example.com
+1 555-555-0100
https://www.linkedin.com/in/janedoe

Experience
Senior Product Manager — DemoLabs — 2022 - 2026
Led B2B SaaS workflow automation roadmap; +20% activation, +12% retention.
Customer discovery interviews; led cross-functional team of 4 engineers.

Skills
Product Management, Roadmap, Customer Discovery, SQL, Figma`;

describe("assessResumeTextQuality — band selection", () => {
  it("returns 'good' for a rich resume with all major signals", () => {
    const quality = assessResumeTextQuality(makeResume(RICH_RESUME));
    expect(quality.status).toBe("good");
    expect(quality.characterCount).toBeGreaterThan(100);
    expect(quality.recommendedFix).toBeNull();
    const sigs = quality.signalsDetected;
    expect(sigs.hasEmail).toBe(true);
    expect(sigs.hasPhone).toBe(true);
    expect(sigs.hasLikelyName).toBe(true);
    expect(sigs.hasRoleTitle).toBe(true);
    expect(sigs.hasDates).toBe(true);
    expect(sigs.hasSkills).toBe(true);
  });

  it("returns 'unreadable' for the extraction-pending placeholder text", () => {
    const placeholder = `${RESUME_EXTRACTION_PENDING_PREFIX}. Add verified facts in the career profile before using this resume for application drafts.`;
    const quality = assessResumeTextQuality(
      makeResume(placeholder, {
        originalFileName: "gopal-resume.pdf",
        fileUrl: "local-upload://resume/x.pdf",
        status: "uploaded"
      })
    );
    expect(quality.status).toBe("unreadable");
    expect(quality.extractedFrom).toBe("pdf");
    expect(quality.warnings[0]).toContain("Text extraction has not run");
    // Recommended fix steers PDF users to paste-or-upload-text.
    expect(quality.recommendedFix).toContain("Paste your resume text");
    expect(quality.recommendedFix).toContain("TXT/MD");
  });

  it("returns 'unreadable' for empty text", () => {
    const quality = assessResumeTextQuality(makeResume(""));
    expect(quality.status).toBe("unreadable");
    expect(quality.warnings[0]).toContain("empty");
  });

  it("returns 'unreadable' for very short text", () => {
    const quality = assessResumeTextQuality(makeResume("Jane"));
    expect(quality.status).toBe("unreadable");
    expect(quality.warnings[0]).toContain("too short");
  });

  it("returns 'poor' for text with only one or two signals", () => {
    const text =
      "This resume mentions an engineer once but has no email, phone, dates, name layout, or skills section.";
    const quality = assessResumeTextQuality(makeResume(text));
    expect(quality.status).toBe("poor");
    expect(quality.recommendedFix).toContain("Paste");
  });

  it("returns 'partial' for text with three or four signals", () => {
    const text = `Jane Doe
Engineer
jane.doe@example.com

Background: built services and shipped features.`;
    const quality = assessResumeTextQuality(makeResume(text));
    expect(quality.status).toBe("partial");
    // hasEmail + hasLikelyName + hasRoleTitle = 3 signals.
    const sigs = quality.signalsDetected;
    const count = Object.values(sigs).filter(Boolean).length;
    expect(count).toBeGreaterThanOrEqual(3);
    expect(count).toBeLessThanOrEqual(4);
  });
});

describe("assessResumeTextQuality — extraction source inference", () => {
  it("infers 'pasted' from the local-paste:// fileUrl prefix", () => {
    const quality = assessResumeTextQuality(
      makeResume(RICH_RESUME, {
        originalFileName: "pasted-resume.txt",
        fileUrl: "local-paste://resume/abc.txt"
      })
    );
    expect(quality.extractedFrom).toBe("pasted");
  });

  it("infers 'demo' from the demo-resume.txt filename", () => {
    const quality = assessResumeTextQuality(
      makeResume(RICH_RESUME, {
        originalFileName: "demo-resume.txt",
        fileUrl: "local-paste://resume/abc.txt"
      })
    );
    expect(quality.extractedFrom).toBe("demo");
  });

  it("infers 'pdf' from the file extension", () => {
    const quality = assessResumeTextQuality(
      makeResume(RICH_RESUME, {
        originalFileName: "jane.pdf",
        fileUrl: "local-upload://resume/x.pdf"
      })
    );
    expect(quality.extractedFrom).toBe("pdf");
  });

  it("infers 'docx' from the file extension", () => {
    const quality = assessResumeTextQuality(
      makeResume(RICH_RESUME, {
        originalFileName: "jane.docx",
        fileUrl: "local-upload://resume/x.docx"
      })
    );
    expect(quality.extractedFrom).toBe("docx");
  });
});

describe("canRunResumeIntelligence — gate", () => {
  it("allows analysis on good and partial quality", () => {
    expect(
      canRunResumeIntelligence(assessResumeTextQuality(makeResume(RICH_RESUME)))
    ).toBe(true);
  });

  it("blocks analysis on unreadable quality (placeholder PDF text)", () => {
    const placeholder = `${RESUME_EXTRACTION_PENDING_PREFIX}. ...`;
    const quality = assessResumeTextQuality(
      makeResume(placeholder, {
        originalFileName: "x.pdf",
        fileUrl: "local-upload://resume/x.pdf",
        status: "uploaded"
      })
    );
    expect(canRunResumeIntelligence(quality)).toBe(false);
  });

  it("blocks analysis on poor quality", () => {
    const text =
      "This resume mentions an engineer once but has no email, phone, dates, name layout, or skills section.";
    expect(
      canRunResumeIntelligence(assessResumeTextQuality(makeResume(text)))
    ).toBe(false);
  });
});

describe("describeResumeQualityForCustomer", () => {
  it("returns customer-facing labels with no provider/model detail", () => {
    const goodLabel = describeResumeQualityForCustomer(
      assessResumeTextQuality(makeResume(RICH_RESUME))
    );
    expect(goodLabel).toBe("Resume text quality: Good");
    // Hard-rule: no provider details ever leak into the customer-
    // facing label.
    expect(goodLabel).not.toMatch(/openai/i);
    expect(goodLabel).not.toMatch(/azure/i);
    expect(goodLabel).not.toMatch(/deterministic/i);
    expect(goodLabel).not.toMatch(/model/i);
    expect(goodLabel).not.toMatch(/prompt/i);
  });
});
