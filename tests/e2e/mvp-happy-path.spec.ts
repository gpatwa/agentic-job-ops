import { expect, test } from "@playwright/test";

const applicationsKey = "ajo:tenant_local_demo:user_local_demo:applications";

test("MVP happy path keeps submit blocked until explicit approval", async ({
  page
}) => {
  await page.goto("/");
  await page.evaluate(() => {
    window.localStorage.clear();
  });

  await page.goto("/#onboarding");

  // Step 1 must always offer a real file upload control alongside paste/demo.
  await expect(
    page.getByTestId("onboarding-resume-file-input")
  ).toBeAttached();

  await page.getByTestId("try-realistic-demo").click();
  await expect(page).toHaveURL(/#action-center$/);
  await expect(page.getByTestId("action-center")).toBeVisible();

  const actionCards = page.getByTestId("action-card");
  await expect(actionCards.first()).toBeVisible();
  expect(await actionCards.count()).toBeGreaterThan(0);

  await page.getByTestId("job-matches-nav").click();
  await expect(page).toHaveURL(/#jobs$/);

  const jobCards = page.getByTestId("job-card");
  await expect(jobCards.first()).toBeVisible();
  expect(await jobCards.count()).toBeGreaterThan(0);

  await page.getByTestId("start-application-prep").first().click();
  await expect(page.getByTestId("application-package-page")).toBeVisible();
  await expect(page).toHaveURL(/#package-review:/);

  await page.getByTestId("approve-package").click();
  await expect(page.getByTestId("start-browser-apply-demo")).toBeVisible();

  await page.getByTestId("start-browser-apply-demo").click();
  await expect(page.getByTestId("browser-session-page")).toBeVisible();
  await expect(page).toHaveURL(/#browser-session:/);
  await expect(page.getByTestId("submit-blocked-message")).toBeVisible();

  const submittedApplications = await page.evaluate((key) => {
    const raw = window.localStorage.getItem(key);
    const applications = raw ? JSON.parse(raw) : [];
    return applications.filter(
      (application: { status?: string }) => application.status === "submitted"
    ).length;
  }, applicationsKey);
  expect(submittedApplications).toBe(0);

  await page.getByTestId("tracker-nav").click();
  await expect(page).toHaveURL(/#tracker$/);
  await expect(page.getByTestId("application-tracker")).toBeVisible();
  await expect(page.getByTestId("application-tracker")).toContainText("[Demo]");

  await page.getByTestId("admin-nav").click();
  await expect(page).toHaveURL(/#admin$/);
  await expect(page.getByTestId("admin-system")).toBeVisible();
  await expect(page.getByTestId("audit-events")).toBeVisible();
  await expect(page.getByTestId("audit-events")).not.toContainText(
    "No audit events yet."
  );
});
