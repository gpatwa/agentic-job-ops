# Product Phases

## Phase 1

Foundation: app shell, tenant-aware data model, profile setup, resume upload, parser placeholder, editable career profile, dashboard shell, empty queues, and tracker.

## Phase 2

Offline job ingestion workers, source configuration, manual scan execution, Greenhouse connector, Lever connector, manual URL import placeholder, normalized job schema, queued scoring status, scan history, visible errors, and deduplication.

## Phase 3

Match engine, 0 to 10 deterministic fallback scoring, placeholder LLM scoring adapter, per-dimension match scores, Apply Review Queue, Maybe Queue, Browse Queue, skip-but-browsable recommendations, low-score explanations, and audit events.

## Phase 4

Dashboard actions, application tracker workflows, status transitions, notes, save/reject/archive behavior, manual application tracking, and placeholder tailored application package boundaries.

## Phase 5

Application package generation: tailored resume draft, cover letter draft, short-answer drafts, deterministic fallback generation, LLM adapter boundary, unsupported-claim warnings, review/edit workflow, approval, and rejection. Do not submit applications.

## Phase 6

Browser application assistant with a deterministic development flow, ATS detection placeholder, form-field detection, safe field mapping from approved package data, pause items for uncertain or sensitive fields, manual-required fallback, tracker visibility, Playwright adapter boundary, and explicit job-seeker approval before any submit action. Do not bypass CAPTCHA, rate limits, or anti-bot systems.

## Phase 7

Evals, feedback events, model and prompt metadata, usage metering, outcome tracking, score calibration basics, admin visibility, audit summaries, and safety checks for application packages and browser assistant workflows. Keep optimization focused on strong-fit, truthful, human-approved applications rather than raw submission volume.

## Phase 8

Real ATS adapter infrastructure for Greenhouse and Lever: adapter interface, URL and form-structure detection, DOM-based field analysis for labels/inputs/selects/textareas/uploads, safe field mapping from approved user-controlled sources, dry-run fill plan previews, adapter confidence, pause handling for uncertain and sensitive fields, fixture-backed evals, and audit/feedback/usage events for adapter runs. Default behavior remains dry-run or fill-only; no live external submit runs by default.

## Future Enterprise Controls

Backend tenant isolation, RBAC, delegated approval rules, usage billing, and production-grade tenant administration.
