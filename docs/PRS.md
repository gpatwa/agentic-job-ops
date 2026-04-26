# Product Requirements Specification

## Phase 1 Scope

Build a clean enterprise SaaS foundation with:

- Landing/dashboard home.
- Profile setup page.
- Resume upload page.
- Career profile review/edit page.
- Job dashboard with empty Apply Review, Maybe, and Browse queues.
- Application tracker page.

## Phase 2 Scope

Build an offline ingestion foundation with:

- Source configuration for Greenhouse and Lever company boards.
- Manual, daily, and every 6 hours scan cadences.
- Manual scan execution from an ingestion admin view.
- Normalized job records with ATS type, salary range, remote type, application URL, and queued scoring status.
- Deduplication by ATS job ID, application URL, company/title/location, and a description similarity placeholder.
- Scan-run history with fetched, inserted, updated, duplicate, and error counts.

## Phase 3 Scope

Build the match engine and scoring service with:

- `JobMatch` and `MatchScore` records for each scored job.
- Per-dimension scores for skills, experience, seniority, location, salary, industry, company fit, application effort, and strategic value.
- Deterministic fallback scoring that works without LLM keys.
- Placeholder LLM scoring adapter that can be swapped in later.
- Manual "Score Jobs Now" dashboard action.
- Queue assignment: Apply Review for 8.0 to 10.0, Maybe for 5.5 to 7.9, Browse below 5.5, and Skip below 3.0 while remaining browsable.
- Explanations with summaries, top reasons, top gaps, employer-looking-for notes, and recommended next action.

## Phase 4 Scope

Build dashboard actions and application tracking workflows with:

- Job card actions: save for later, reject, archive, move to Apply Review, move to Maybe, start application prep, add/edit notes, mark manually applied, and mark not interested.
- Application record creation or update for every user action.
- Manual status updates across discovered, recommended, saved, draft prepared, needs review, approved, submitted, recruiter contacted, interviewing, rejected, offer, and archived.
- Tracker grouped by status with source job, company, title, match score, last updated date, and notes.
- Audit events for job saves, rejects, archives, queue overrides, prep start, status changes, note updates, and manual applications.
- Application package generator boundary prepared for Phase 5.

## Phase 5 Scope

Build application package generation with:

- `ApplicationPackage` records for generated resume drafts, cover letter drafts, generation metadata, hashes, status, and safety warnings.
- `ApplicationAnswer` records for common application questions, generated answers, confidence, source, and review flags.
- Deterministic package generation that works without API keys.
- Placeholder LLM generation adapter that can be swapped in later.
- Package review page with resume preview, cover letter preview, short-answer editing, safety warnings, approve, and reject actions.
- Tracker and job dashboard links into package review.
- Audit events for generation, edits, answer edits, approval, rejection, and unsupported-claim warnings.

## Phase 6 Scope

Build a browser application assistant foundation with:

- `BrowserApplicationSession` records for tenant-scoped browser apply sessions.
- Deterministic browser-session flow that works without real external automation.
- Playwright adapter boundary for future real browser control.
- ATS detection placeholder, form-field detection, safe field mapping, uncertain-field pauses, and screenshot placeholder support.
- Package review entry point for approved packages only.
- Human approval gate before submit, including persisted approval audit verification for the same approved session.
- Manual-required fallback when automation should pause or cannot safely continue.
- Tracker visibility for browser session state.
- Tests for session state transitions and submit approval guardrails.

## Phase 7 Scope

Build quality, safety, and enterprise visibility foundations with:

- `FeedbackEvent` records for major product actions, edits, approvals, submissions, and outcomes.
- `UsageMeteringEvent` records for operational events such as uploads, source creation, scans, ingestion, scoring, packages, browser sessions, submit approvals, submissions, and token placeholders.
- `EvalCase`, `EvalRun`, and `EvalResult` records with deterministic sample suites.
- `ApplicationOutcome` records for recruiter responses, interviews, rejections, offers, withdrawals, and submitted applications.
- `AIOutputMetadata` records for model, prompt, version, generation mode, and hash metadata without storing sensitive generated content.
- Admin/system dashboard with audit, feedback, usage, eval, outcome, and failure summaries.
- Score calibration basics and safety eval checks for match scoring, application package truthfulness, and browser assistant approval guardrails.

## Phase 8 Scope

Build real ATS adapter infrastructure with:

- `ATSAdapter` interface for detection, form analysis, fill-plan creation, dry-run/fill-only execution, review prep, and submit-after-approval.
- Greenhouse adapter for `greenhouse.io`, `boards.greenhouse.io`, common Greenhouse form structure, first name, last name, email, phone, resume upload, cover letter upload, and custom questions.
- Lever adapter for `jobs.lever.co`, Lever form structure, name, email, phone, resume upload, links, and additional information fields.
- Adapter selection from application URL and form structure with adapter confidence.
- DOM-based fixture analysis for labels, inputs, selects, textareas, and upload controls.
- Redacted dry-run fill plan preview showing safe fields, upload actions, skipped fields, and user-required fields.
- Pause handling for CAPTCHA, login, demographic fields, veteran/disability/race/gender fields, missing salary expectations, unclear required questions, and final submit.
- Audit, feedback, usage, and eval events for adapter runs.
- Greenhouse-like and Lever-like fixtures for deterministic tests and evals.

## Functional Requirements

- Users can create and edit a career profile.
- Users can upload a resume record or create a clearly labeled placeholder upload.
- Users can view placeholder parsed resume text.
- Dashboard shows profile completion, resume status, empty queues, tracker status, and recent audit activity.
- All tenant-owned records include `tenantId` and `userId`.
- Operators can configure Greenhouse and Lever sources and run scans.
- Operators can import a manual job URL as a queued placeholder.
- New jobs are queued for Phase 3 scoring and not scored in Phase 2.
- Users can run match scoring manually.
- Scored jobs appear in Apply Review, Maybe, or Browse queues.
- Low-score and skipped jobs remain visible with useful explanations.
- Scoring creates audit events without logging sensitive profile content.
- Users can take next-step actions on scored jobs.
- Users can save, reject, archive, add notes, move jobs between queues, and start an application prep placeholder.
- Rejected and archived jobs are retained for history and filtering.
- Users can start application prep and receive a reviewable package.
- Users can edit generated resume, cover letter, and answers before approving.
- Users can approve or reject a generated package.
- Unsupported-claim warnings are visible when generated or edited text mentions risky unsupported claims.
- Users can start browser apply only from an approved application package.
- Browser sessions show detected fields, filled fields, uncertain fields, status, and manual fallback controls.
- Browser sessions show adapter type, adapter confidence, fill mode, and redacted fill plan preview.
- Assistant submission remains blocked until the same session has an approved package, ready-for-review status, explicit job-seeker approval, and a matching submit-approval audit event.
- Application records move to submitted only after confirmed assistant submission or an explicit manual submitted action.
- Feedback and usage events are recorded for major workflow actions.
- Admin users can run deterministic evals and review pass/fail summaries.
- Admin users can review usage, feedback, outcomes, recent audit events, and recent failures.
- Greenhouse-like and Lever-like fixtures can be detected and converted into fill plans.
- Default ATS adapter execution is dry-run or fill-only; no live external submit runs by default.

## Non-Functional Requirements

- Use TypeScript.
- Keep business logic in services and helpers, not React components.
- Use validation schemas for domain records.
- Do not log resume content, sensitive profile data, credentials, or application answers.
- Preserve a service boundary for ingestion, matching, AI generation, and browser-agent workflows.
- Require human approval before any future application submission.
- Do not optimize for the number of applications submitted; optimize for strong-fit applications, approval quality, recruiter response rate, interview conversion, truthful generated content, and low unsupported-claim rate.
