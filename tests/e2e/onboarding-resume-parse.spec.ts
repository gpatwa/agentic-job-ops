import { expect, test } from "@playwright/test";

const PASTE_RESUME = `Jane Doe
Senior Product Manager
Remote
jane.doe@example.com
+1 555-555-0100

Experience
Senior Product Manager — DemoLabs — 2022 - 2026
Led B2B SaaS workflow automation roadmap; +20% activation.

Skills
Product Management, Roadmap, Customer Discovery, SQL`;

test.describe("Onboarding resume parsing — server-side extraction flow", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => window.localStorage.clear());
    await page.goto("/#onboarding");
  });

  test("uploading a fake PDF with the API offline still surfaces the parsing-issue card", async ({
    page
  }) => {
    // qa:mvp doesn't spin up the AI API server. The frontend's
    // upload handler tries the API, gets ApiResumeParseUnavailable
    // Error, falls back to the placeholder-text path. The
    // existing parsing-issue card kicks in via the local
    // assessResumeTextQuality gate.
    await page.getByTestId("onboarding-resume-file-input").setInputFiles({
      name: "scanned.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d])
    });
    await page.getByTestId("onboarding-upload-resume").click();
    await expect(page.getByTestId("onboarding-resume-completed")).toBeVisible();

    const issueCard = page.getByTestId("resume-parsing-issue-card");
    await expect(issueCard).toBeVisible();
    await expect(
      page.getByTestId("resume-parsing-issue-paste-input")
    ).toBeVisible();

    // No customer-facing provider/model strings should be visible
    // on this page even when the parsing-issue path runs.
    expect(
      await page.getByText(/Source:\s*OpenAI LLM/i).count()
    ).toBe(0);
    expect(
      await page.getByText(/Source:\s*deterministic fallback/i).count()
    ).toBe(0);
    expect(await page.getByText(/MODEL:/).count()).toBe(0);
  });

  test("pasting resume text from the parsing-issue card unlocks normal analysis", async ({
    page
  }) => {
    await page.getByTestId("onboarding-resume-file-input").setInputFiles({
      name: "scanned.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d])
    });
    await page.getByTestId("onboarding-upload-resume").click();
    await expect(page.getByTestId("resume-parsing-issue-card")).toBeVisible();

    await page
      .getByTestId("resume-parsing-issue-paste-input")
      .fill(PASTE_RESUME);
    await page.getByTestId("resume-parsing-issue-paste-submit").click();

    await expect(
      page.getByTestId("resume-parsing-issue-card")
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /Analyze resume/i })
    ).toBeVisible();
  });

  test("uploading a TXT resume parses locally and unlocks analysis directly", async ({
    page
  }) => {
    await page.getByTestId("onboarding-resume-file-input").setInputFiles({
      name: "jane.txt",
      mimeType: "text/plain",
      buffer: Buffer.from(PASTE_RESUME, "utf-8")
    });
    await page.getByTestId("onboarding-upload-resume").click();
    await expect(page.getByTestId("onboarding-resume-completed")).toBeVisible();
    // No parsing-issue card — TXT parses locally with full quality.
    await expect(
      page.getByTestId("resume-parsing-issue-card")
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /Analyze resume/i })
    ).toBeVisible();
  });
});
