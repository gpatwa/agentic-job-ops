import { expect, test } from "@playwright/test";

const REFERENCE_GREENHOUSE_URL =
  "https://job-boards.greenhouse.io/afresh/jobs/5843891004";
const applicationsKey = "ajo:tenant_local_demo:user_local_demo:applications";
const normalizedJobsKey =
  "ajo:tenant_local_demo:user_local_demo:normalized_jobs";

test("paste a Greenhouse job URL during onboarding → import + score → start prep → approve → browser apply (submit blocked)", async ({
  page
}) => {
  // Clean slate, then seed a realistic workspace (resume + report + targets
  // + jobs) via the existing demo path. This puts onboarding into the
  // jobs step where the new URL import section is visible.
  await page.goto("/");
  await page.evaluate(() => window.localStorage.clear());
  await page.goto("/#onboarding");
  await page.getByTestId("try-realistic-demo").click();
  await expect(page).toHaveURL(/#action-center$/);

  // Navigate back to onboarding — the URL import section now renders
  // because we're on the targets/jobs step.
  await page.goto("/#onboarding");
  await expect(page.getByTestId("onboarding-job-url-section")).toBeVisible();

  // Paste the Greenhouse reference URL and import.
  await page
    .getByTestId("onboarding-job-url-input")
    .fill(REFERENCE_GREENHOUSE_URL);
  await page.getByTestId("onboarding-import-job-url").click();

  // The imported job card appears with the company slug title-cased.
  const card = page.getByTestId("onboarding-imported-job-card");
  await expect(card).toBeVisible();
  await expect(card).toContainText("Afresh");

  // Score pill is present and contains "/ 10".
  const scorePill = page.getByTestId("onboarding-imported-job-score");
  await expect(scorePill).toBeVisible();
  await expect(scorePill).toContainText("/ 10");

  // Status pill confirms the import landed (text varies by path; we just
  // assert it's visible and non-empty).
  await expect(page.getByTestId("onboarding-job-url-status")).toBeVisible();

  // Start application prep directly from the imported job card. The
  // existing handler creates the application + package and routes us
  // to the package review page.
  await page.getByTestId("onboarding-start-prep-from-url").click();
  await expect(page.getByTestId("application-package-page")).toBeVisible();
  await expect(page).toHaveURL(/#package-review:/);

  // Approve the package, then start the browser apply demo session.
  await page.getByTestId("approve-package").click();
  await expect(page.getByTestId("start-browser-apply-demo")).toBeVisible();
  await page.getByTestId("start-browser-apply-demo").click();
  await expect(page.getByTestId("browser-session-page")).toBeVisible();
  await expect(page).toHaveURL(/#browser-session:/);

  // The submit gate is the whole point — it must stay closed.
  await expect(page.getByTestId("submit-blocked-message")).toBeVisible();

  // Defense-in-depth: no application is in "submitted" status anywhere
  // in local storage after this whole flow.
  const submittedCount = await page.evaluate((key) => {
    const raw = window.localStorage.getItem(key);
    const apps = raw ? JSON.parse(raw) : [];
    return apps.filter(
      (a: { status?: string }) => a.status === "submitted"
    ).length;
  }, applicationsKey);
  expect(submittedCount).toBe(0);
});

test("re-importing the same Greenhouse URL is idempotent in localStorage", async ({
  page
}) => {
  await page.goto("/");
  await page.evaluate(() => window.localStorage.clear());
  await page.goto("/#onboarding");
  await page.getByTestId("try-realistic-demo").click();
  await expect(page).toHaveURL(/#action-center$/);
  await page.goto("/#onboarding");

  // Snapshot job count after demo seed.
  const before = await page.evaluate((key) => {
    const raw = window.localStorage.getItem(key);
    return (raw ? JSON.parse(raw) : []).length;
  }, normalizedJobsKey);

  // First import.
  await page
    .getByTestId("onboarding-job-url-input")
    .fill(REFERENCE_GREENHOUSE_URL);
  await page.getByTestId("onboarding-import-job-url").click();
  await expect(page.getByTestId("onboarding-imported-job-card")).toBeVisible();

  const afterFirst = await page.evaluate((key) => {
    const raw = window.localStorage.getItem(key);
    return (raw ? JSON.parse(raw) : []).length;
  }, normalizedJobsKey);
  expect(afterFirst).toBe(before + 1);

  // Second import of the same URL — should hit the dedupe path and
  // NOT add a new record.
  await page
    .getByTestId("onboarding-job-url-input")
    .fill(REFERENCE_GREENHOUSE_URL);
  await page.getByTestId("onboarding-import-job-url").click();
  await expect(page.getByTestId("onboarding-imported-job-card")).toBeVisible();

  const afterSecond = await page.evaluate((key) => {
    const raw = window.localStorage.getItem(key);
    return (raw ? JSON.parse(raw) : []).length;
  }, normalizedJobsKey);
  expect(afterSecond).toBe(afterFirst);
});
