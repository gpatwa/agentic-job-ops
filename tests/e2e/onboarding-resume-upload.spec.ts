import { expect, test } from "@playwright/test";

// Local ambient so this Playwright spec can use Node's Buffer without
// pulling in @types/node project-wide. Playwright always runs the spec
// file in Node, so Buffer is real at runtime.
declare const Buffer: {
  from(input: string, encoding?: string): ArrayBuffer;
  from(input: number[]): ArrayBuffer;
};

const resumeKey = "ajo:tenant_local_demo:user_local_demo:resume";

const TXT_RESUME = `Jane Doe
Senior Product Manager
jane@example.com
+1 555-555-0100
https://www.linkedin.com/in/janedoe

Experience
Senior Product Manager — DemoLabs — 2022 - 2026
Led B2B SaaS workflow automation roadmap; +20% activation.

Skills
Product Management, Roadmap`;

test.describe("Onboarding Step 1 resume upload", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => window.localStorage.clear());
    await page.goto("/#onboarding");
  });

  test("renders a file input on Step 1 with the documented test ID", async ({
    page
  }) => {
    const fileInput = page.getByTestId("onboarding-resume-file-input");
    // Visually sr-only but must be in the DOM and have the expected accept list.
    await expect(fileInput).toBeAttached();
    const accept = await fileInput.getAttribute("accept");
    expect(accept).toBe(".pdf,.doc,.docx,.txt,.md");

    // Upload button is present and disabled before a file is chosen.
    const uploadBtn = page.getByTestId("onboarding-upload-resume");
    await expect(uploadBtn).toBeVisible();
    await expect(uploadBtn).toBeDisabled();
  });

  test("uploading a .txt resume parses the text and advances to the Intelligence step", async ({
    page
  }) => {
    await page.getByTestId("onboarding-resume-file-input").setInputFiles({
      name: "jane.txt",
      mimeType: "text/plain",
      buffer: Buffer.from(TXT_RESUME, "utf-8")
    });
    await page.getByTestId("onboarding-upload-resume").click();

    // The existing-resume banner replaces the start card once the resume is
    // saved, showing the uploaded filename and the Replace control.
    const completed = page.getByTestId("onboarding-resume-completed");
    await expect(completed).toBeVisible();
    await expect(completed).toContainText("jane.txt");
    await expect(page.getByTestId("onboarding-replace-resume")).toBeVisible();

    // The Intelligence step is now reachable — its Analyze button is rendered.
    await expect(
      page.getByRole("button", { name: /Analyze resume/i })
    ).toBeVisible();

    // The persisted Resume record carries the parsed text (status=parsed).
    const persisted = await page.evaluate((key) => {
      const raw = window.localStorage.getItem(key);
      const parsed = raw ? JSON.parse(raw) : null;
      return {
        status: parsed?.status,
        fileName: parsed?.originalFileName,
        textLength: (parsed?.parsedText ?? "").length,
        startsWith: (parsed?.parsedText ?? "").slice(0, 8)
      };
    }, resumeKey);
    expect(persisted.status).toBe("parsed");
    expect(persisted.fileName).toBe("jane.txt");
    expect(persisted.textLength).toBeGreaterThan(0);
    expect(persisted.startsWith).toBe("Jane Doe");
  });

  test("uploading a .pdf stores metadata and shows text extraction pending", async ({
    page
  }) => {
    await page.getByTestId("onboarding-resume-file-input").setInputFiles({
      name: "resume.pdf",
      mimeType: "application/pdf",
      // %PDF- magic bytes; we never decode them.
      buffer: Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d])
    });
    await page.getByTestId("onboarding-upload-resume").click();

    const completed = page.getByTestId("onboarding-resume-completed");
    await expect(completed).toBeVisible();
    await expect(completed).toContainText("resume.pdf");

    // The Resume domain record reflects the binary path: status=uploaded
    // (not parsed) and the placeholder pending text.
    const persisted = await page.evaluate((key) => {
      const raw = window.localStorage.getItem(key);
      const parsed = raw ? JSON.parse(raw) : null;
      return {
        status: parsed?.status,
        fileName: parsed?.originalFileName,
        parsedText: parsed?.parsedText
      };
    }, resumeKey);
    expect(persisted.status).toBe("uploaded");
    expect(persisted.fileName).toBe("resume.pdf");
    expect(persisted.parsedText).toContain(
      "Resume text extraction has not run yet"
    );
  });

  test("an existing resume exposes the Replace control on Step 1", async ({
    page
  }) => {
    // First upload puts a resume in place.
    await page.getByTestId("onboarding-resume-file-input").setInputFiles({
      name: "jane.txt",
      mimeType: "text/plain",
      buffer: Buffer.from(TXT_RESUME, "utf-8")
    });
    await page.getByTestId("onboarding-upload-resume").click();
    await expect(page.getByTestId("onboarding-resume-completed")).toBeVisible();

    // The Replace control is the documented test ID and is currently disabled
    // until a new file is chosen.
    const replaceBtn = page.getByTestId("onboarding-replace-resume");
    await expect(replaceBtn).toBeVisible();
    await expect(replaceBtn).toBeDisabled();

    // Choose a new file — the Replace control enables, click, and the status
    // pill appears with the new filename + parsed-locally label.
    await page
      .getByTestId("onboarding-resume-file-input")
      .setInputFiles({
        name: "jane-v2.md",
        mimeType: "text/markdown",
        buffer: Buffer.from(`# Jane v2\n\n${TXT_RESUME}`, "utf-8")
      });
    await expect(replaceBtn).toBeEnabled();
    await replaceBtn.click();

    const status = page.getByTestId("onboarding-resume-upload-status");
    await expect(status).toBeVisible();
    await expect(status).toContainText("jane-v2.md");
    await expect(status).toContainText("text parsed locally");
  });
});
