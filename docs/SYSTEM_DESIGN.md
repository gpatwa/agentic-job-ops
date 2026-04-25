# System Design

## Architecture

Phase 1 is a client-side React/Vite TypeScript app with local persistence. The code is organized around domain models, validation schemas, and services so a backend can replace local storage later.

## Modules

- `src/models`: Tenant-aware TypeScript models and Zod schemas.
- `src/services/profileService.ts`: Profile draft normalization, validation, and persistence.
- `src/services/resumeService.ts`: Resume upload record creation and parser placeholder.
- `src/services/auditLog.ts`: Sanitized audit events for important actions.
- `src/services/applicationWorkflow.ts`: Phase 4 dashboard actions, application record upserts, queue overrides, and workflow audit metadata.
- `src/services/applicationPackage.ts`: Phase 5 application package generation, deterministic fallback, LLM adapter boundary, safety checks, package persistence, answer persistence, and approval workflow.
- `src/services/jobIngestion.ts`: Phase 2 source configs, Greenhouse/Lever connectors, manual URL placeholder import, scan-run logging, schedule due checks, and deduplication.
- `src/services/matchEngine.ts`: Phase 3 deterministic scoring adapter, placeholder LLM adapter, match persistence, queue mapping, and job status updates.
- `src/services/browserApplicationAssistant.ts`: Browser application session state machine, deterministic adapter, Playwright adapter boundary, safe field mapping, approval guardrails, and manual-required fallback.
- `prisma/schema.prisma`: PostgreSQL-ready model reference.

## Ingestion Flow

1. An operator creates a `JobSourceConfig` for a Greenhouse board token or Lever site name.
2. A manual scan creates a `ScanRun` in running state.
3. The connector fetches public postings and normalizes them into `NormalizedJob` records.
4. Deduplication checks ATS job ID, application URL, company/title/location, and a description-similarity placeholder.
5. New records are stored with `scoringStatus: queued`.
6. The scan run is completed with counts or failed with a visible error message.

The Greenhouse connector uses the public Job Board API `GET /v1/boards/{board_token}/jobs?content=true`. The Lever connector uses the Postings API `GET /v0/postings/{site}?mode=json&limit=100`.

`runDueScheduledScans` is the offline worker entry point for a future cron or queue worker. The browser admin view only triggers manual scans.

## Match Scoring Flow

1. A user clicks "Score Jobs Now" from the dashboard or job queues.
2. The match engine scores each normalized job against the current career profile.
3. The deterministic adapter produces best-effort scores without API keys.
4. A future LLM adapter can replace or augment deterministic scoring through the same `MatchScoringAdapter` interface.
5. Each match stores per-dimension scores, recommendation, summary, reasons, gaps, employer-looking-for notes, and next action.
6. Apply recommendations route to Apply Review, maybe recommendations route to Maybe, and browse or skip recommendations route to Browse.
7. Jobs below 3.0 are marked skip but remain searchable and visible in Browse.

Incomplete profiles generate a visible warning while still producing best-effort scores. Weak job descriptions are scored conservatively.

## Application Workflow

Dashboard actions create or update `ApplicationRecord` rows with tenant and user scope. Rejected and archived jobs are never deleted; they remain available in the tracker and source job store. Queue override actions update the match queue while preserving the original score and logging a user override event.

Notes are stored on the application record, but audit metadata records only note length and status, not note content. Marking a job submitted requires the explicit manual applied action or a deliberate tracker status change.

## Application Package Flow

1. A user clicks "Start application prep" on a scored job.
2. The application workflow sets the `ApplicationRecord` status to `draft_prepared`.
3. The package service generates or updates an `ApplicationPackage` and default `ApplicationAnswer` rows.
4. The deterministic generator uses only profile fields, verified facts, parsed resume text, job requirements, and job responsibilities.
5. The unsupported-claim checker flags suspicious company, tool, credential, and metric mentions that are not present in the evidence.
6. The package review page lets the user edit the resume draft, cover letter draft, and answers.
7. Approval marks the package approved and moves the application record to `approved`. Rejection marks the package rejected and returns the application to `needs_review`.

The LLM package generator is represented by `ApplicationPackageGenerator`. It is intentionally a placeholder until model-backed generation is configured.

## Browser Application Flow

1. A user opens an approved application package and starts browser apply.
2. The browser assistant creates a `BrowserApplicationSession` scoped to the tenant and user.
3. The deterministic adapter detects the ATS, form fields, safely fillable fields, and pause items.
4. Safe fields are mapped from profile data, resume/package drafts, and approved application answers without storing private answer text in audit logs.
5. CAPTCHA, login challenges, demographic questions, missing salary expectations, low-confidence required fields, and final submit always pause for human control.
6. The browser session page shows detected fields, filled-field provenance, pause items, and a screenshot placeholder.
7. The job seeker must move the session to review, explicitly approve submit, and then choose the assistant submit action.
8. The tracker updates to submitted only after confirmed submission or an explicit manual application action.

The Playwright adapter is represented by `BrowserAutomationAdapter` and `PlaywrightBrowserAutomationAdapterBoundary`. It is intentionally a boundary until real browser automation is configured.

## Data Protection

Audit metadata is intentionally narrow. Resume content, profile details, credentials, and application answers must not be logged. Future backend implementation should enforce tenant isolation at query and authorization layers.

## Human Approval Gate

Browser submit approval requires the job seeker identity and an explicit approval flag. The submit action is unavailable until the session reaches `ready_for_review`, and the assistant cannot submit until the session is `approved_for_submit`.
