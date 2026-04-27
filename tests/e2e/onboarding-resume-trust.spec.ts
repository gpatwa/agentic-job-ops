import { expect, test } from "@playwright/test";

const PASTE_RESUME = `Jane Doe
Senior Product Manager
Remote
jane.doe@example.com
+1 555-555-0100
https://www.linkedin.com/in/janedoe

Experience
Senior Product Manager — DemoLabs — 2022 - 2026
Led B2B SaaS workflow automation roadmap; +20% activation, +12% retention.

Skills
Product Management, Roadmap, Customer Discovery, SQL`;

test.describe("Onboarding resume parsing trust", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => window.localStorage.clear());
    await page.goto("/#onboarding");
  });

  test("uploading a PDF whose text we cannot extract shows the parsing-issue card and never exposes provider details", async ({
    page
  }) => {
    // Upload a PDF — the local-MVP path stores metadata only and
    // sets the resume's parsedText to a placeholder. The new
    // quality gate must catch this and refuse to surface a
    // confidently-wrong analysis.
    await page.getByTestId("onboarding-resume-file-input").setInputFiles({
      name: "gopal-resume.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d]) // %PDF- magic
    });
    await page.getByTestId("onboarding-upload-resume").click();
    await expect(page.getByTestId("onboarding-resume-completed")).toBeVisible();

    // Resume Intelligence section must show the parsing-issue card,
    // NOT the analyse button or a fake report.
    const issueCard = page.getByTestId("resume-parsing-issue-card");
    await expect(issueCard).toBeVisible();
    // The card's headline copy varies by source: the local fallback
    // says "couldn't read enough text from this resume", the
    // server-side parse diagnostic (when the API is up) says
    // "couldn't read text from this PDF". Accept either by
    // matching the substring they share.
    await expect(issueCard).toContainText(/couldn't read.*text/i);
    await expect(issueCard).toContainText("Paste your resume text");
    await expect(
      page.getByTestId("resume-parsing-issue-paste-input")
    ).toBeVisible();

    // Hard rule: no provider / model / prompt strings visible to
    // the customer anywhere on the page. Running these as
    // count()===0 lets us assert absence without waiting for
    // visibility timeouts.
    expect(
      await page.getByText(/Source:\s*OpenAI LLM/i).count()
    ).toBe(0);
    expect(
      await page.getByText(/Source:\s*Azure OpenAI/i).count()
    ).toBe(0);
    expect(
      await page.getByText(/Source:\s*deterministic fallback/i).count()
    ).toBe(0);
    expect(await page.getByText(/MODEL:/).count()).toBe(0);
    expect(await page.getByText(/PROMPT:/).count()).toBe(0);
  });

  test("pasting resume text from the parsing-issue card unlocks normal analysis", async ({
    page
  }) => {
    // Same starting condition: PDF upload → parsing issue card.
    await page.getByTestId("onboarding-resume-file-input").setInputFiles({
      name: "gopal-resume.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d])
    });
    await page.getByTestId("onboarding-upload-resume").click();
    await expect(page.getByTestId("resume-parsing-issue-card")).toBeVisible();

    // Paste a real resume into the card's textarea and submit.
    await page
      .getByTestId("resume-parsing-issue-paste-input")
      .fill(PASTE_RESUME);
    await page.getByTestId("resume-parsing-issue-paste-submit").click();

    // The parsing-issue card disappears and the Analyze button
    // becomes available because text quality is now good.
    await expect(
      page.getByTestId("resume-parsing-issue-card")
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /Analyze resume/i })
    ).toBeVisible();
    // Quality badge appears with a customer-friendly label only.
    const qualityBadge = page.getByTestId("resume-quality-badge");
    await expect(qualityBadge).toBeVisible();
    await expect(qualityBadge).toContainText(/Resume text quality:/);
    // And the badge intentionally does NOT name a provider.
    await expect(qualityBadge).not.toContainText(/openai/i);
    await expect(qualityBadge).not.toContainText(/deterministic/i);
  });

  test("Admin/System exposes AI diagnostics for operators (not customers)", async ({
    page
  }) => {
    await page.getByTestId("admin-nav").click();
    await expect(page).toHaveURL(/#admin$/);
    const diagnostics = page.getByTestId("ai-diagnostics");
    await expect(diagnostics).toBeVisible();
    // The provider field is the operator-facing one; the customer
    // never sees this, but operators do.
    await expect(
      page.getByTestId("ai-diagnostics-provider")
    ).toBeVisible();
    await expect(page.getByTestId("ai-diagnostics-model")).toBeVisible();
    await expect(
      page.getByTestId("ai-diagnostics-service-status")
    ).toBeVisible();
    // Defense-in-depth: no API-key-shaped string in the
    // diagnostics panel even when the page renders.
    await expect(diagnostics).not.toContainText(/sk-[A-Za-z0-9]{8,}/);
    await expect(diagnostics).not.toContainText(/Bearer\s+[A-Za-z0-9]{8,}/);
  });
});
