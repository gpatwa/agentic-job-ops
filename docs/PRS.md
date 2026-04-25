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

## Non-Functional Requirements

- Use TypeScript.
- Keep business logic in services and helpers, not React components.
- Use validation schemas for domain records.
- Do not log resume content, sensitive profile data, credentials, or application answers.
- Preserve a service boundary for ingestion, matching, AI generation, and browser-agent workflows.
- Require human approval before any future application submission.
