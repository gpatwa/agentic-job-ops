# QA Happy Path

Use this checklist for MVP verification. The expected result is a working B2C demo flow with no blind auto-apply and no live external submit.

## Automated QA

Run the automated regression suite before shipping product changes:

```bash
npm run qa:mvp
```

This command runs typecheck, unit tests, production build, and the Playwright MVP happy-path test.

The automated Playwright test covers:

- Clean local workspace startup.
- Realistic demo seeding.
- Action Center rendering with pending actions.
- Job Matches rendering with scored jobs.
- Starting application prep from a strong match.
- Application package page opening and package approval.
- Browser apply demo session creation.
- Submit blocked before explicit approval.
- Tracker visibility for application context.
- Admin/System audit event visibility.

A separate Playwright spec
(`tests/e2e/onboarding-job-url.spec.ts`) covers the optional
"paste a known job URL during onboarding" path:

- Paste a Greenhouse job URL into the onboarding URL section.
- See the imported job card appear with a match score.
- Start application prep from the imported job.
- Approve the package and start the browser apply demo.
- Confirm submit is still blocked (the gate applies to URL-imported
  jobs the same way it applies to recommended jobs).
- Re-importing the same URL is idempotent (no duplicate record).

Users can paste a known job URL during onboarding to start from a
specific role instead of the recommended queue. The same approval
gates apply.

Manual QA is still useful for copy polish, visual layout review across viewports, exploratory package editing, and browser-extension edge cases.

## Preconditions

- Run the app locally.
- Use a development/demo workspace.
- Keep browser devtools console visible if checking runtime errors.
- Do not use real personal data for this demo pass.

## Steps

1. Start clean workspace.
   - Use `Clear local workspace` from the app if local demo data exists.
   - Reload the app.
   - Expected: the default route is Onboarding.

2. Try realistic demo.
   - Click `Try realistic demo`.
   - If prompted about replacing local data, confirm only in a demo workspace.
   - Expected: the app routes to Action Center and all seeded records are visibly labeled demo.

3. Analyze resume.
   - Open Onboarding.
   - Confirm the demo resume and resume intelligence sections are present.
   - Run or rerun resume analysis if available.
   - Expected: parsed profile facts, ATS risk, target recommendations, and warnings stay visible.

4. Confirm targets.
   - Review recommended roles.
   - Confirm or save target roles.
   - Expected: selected target roles include product management oriented demo targets.

5. See apply-ready jobs.
   - Open Job Matches.
   - Review Apply Review, Maybe, and Browse.
   - Expected: demo jobs appear with match scores, reasons, gaps, recommended next action, and demo labels.

6. Start application prep.
   - From a scored job, choose `Start application prep` if no package exists, or open an existing demo package.
   - Expected: an ApplicationRecord exists with draft/prep status. No submitted status is created.

7. Approve package.
   - Open the package review page.
   - Review resume draft, cover letter, answers, metadata, and safety warnings.
   - Edit at least one field if needed, then approve.
   - Expected: package status becomes approved and tracker reflects the status.

8. Start browser apply demo.
   - From the approved package, choose `Start browser apply`.
   - Expected: browser application session is created and linked from tracker.

9. Confirm submit remains blocked without approval.
   - Open the browser session review page.
   - Try the submit path before explicit approval if the UI offers a test action.
   - Expected: submit is blocked unless package is approved, session is ready for review, and explicit user approval is recorded for that same session.

10. View Action Center.
    - Open Action Center.
    - Expected: package review, high-match review, or follow-up actions are visible. Final submit approval copy clearly says human approval is required.

11. Complete or dismiss an action.
    - Mark one non-submit action done or dismiss it.
    - Expected: the action leaves the pending list and audit/feedback behavior remains stable.

12. Verify tracker updates.
    - Open Applications.
    - Expected: application records show source job, match score, package link, browser session status when present, notes, and last updated date.
    - Expected: no record is marked submitted unless the user explicitly chose manual submitted or a confirmed approved assistant submission exists.

## Pass Criteria

- No internal phase copy is visible in the happy path.
- Demo data is labeled demo.
- Action Center is useful after seeding.
- Job Matches show scored jobs across queues.
- Application package review, edit, approve, and reject flows work.
- Browser assistant remains dry-run/review oriented.
- Submit remains blocked without explicit approval.
- Tracker reflects package and browser session context.

## Fail Conditions

- Any application is submitted automatically.
- A browser session submits without explicit approval.
- Demo seed overwrites non-demo user data without confirmation.
- Low-score jobs disappear from Browse.
- Generated content includes unsupported real claims without warnings.
- The app crashes during the happy path.
