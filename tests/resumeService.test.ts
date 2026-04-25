import { describe, expect, it } from "vitest";
import { currentSession } from "../src/data/currentSession";
import { createResumeUpload } from "../src/services/resumeService";

describe("createResumeUpload", () => {
  it("creates a tenant and user scoped resume placeholder", () => {
    const resume = createResumeUpload(currentSession, {
      fileName: "resume.pdf",
      hasLocalFile: true
    });

    expect(resume.tenantId).toBe(currentSession.tenant.id);
    expect(resume.userId).toBe(currentSession.userId);
    expect(resume.status).toBe("parsed");
    expect(resume.parsedText).toContain("placeholder");
  });
});
