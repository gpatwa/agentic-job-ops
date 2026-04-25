# System Design

## Architecture

Phase 1 is a client-side React/Vite TypeScript app with local persistence. The code is organized around domain models, validation schemas, and services so a backend can replace local storage later.

## Modules

- `src/models`: Tenant-aware TypeScript models and Zod schemas.
- `src/services/profileService.ts`: Profile draft normalization, validation, and persistence.
- `src/services/resumeService.ts`: Resume upload record creation and parser placeholder.
- `src/services/auditLog.ts`: Sanitized audit events for important actions.
- `src/services/jobIngestion.ts`: Phase 2 source configs, Greenhouse/Lever connectors, manual URL placeholder import, scan-run logging, schedule due checks, and deduplication.
- `src/services/matchEngine.ts`: Phase 3 deterministic scoring adapter, placeholder LLM adapter, match persistence, queue mapping, and job status updates.
- `src/services/browserApplicationAssistant.ts`: Phase 5 browser assistant placeholder with explicit approval requirement.
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

## Data Protection

Audit metadata is intentionally narrow. Resume content, profile details, credentials, and application answers must not be logged. Future backend implementation should enforce tenant isolation at query and authorization layers.

## Human Approval Gate

The browser application assistant boundary accepts an `approvedByUser` flag and rejects unapproved requests. Future implementation must keep final submit behind an explicit user approval step.
