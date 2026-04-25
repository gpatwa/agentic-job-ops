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

## Non-Functional Requirements

- Use TypeScript.
- Keep business logic in services and helpers, not React components.
- Use validation schemas for domain records.
- Do not log resume content, sensitive profile data, credentials, or application answers.
- Preserve a service boundary for ingestion, matching, AI generation, and browser-agent workflows.
- Require human approval before any future application submission.
