# Project Instructions

This project is an enterprise SaaS platform for agentic AI job search and human-approved job applications.

Core principle:
The AI does the work. The human makes the decision.

Do not build blind auto-apply. Every job application submission must require explicit user approval.

## Product Scope

The platform has four major systems:

1. Frontend for user profile and resume upload
2. Offline job ingestion pipeline
3. Match engine and scoring service
4. Dashboard for review and next-step actions

Later phases include:
- Tailored resume and cover letter generation
- Browser-based application assistant using Playwright
- Human approval gate before submit
- RL/evals feedback loop
- Enterprise SaaS tenant isolation, RBAC, audit logs, and usage metering

## Engineering Rules

- Use TypeScript.
- Prefer clean, simple, maintainable code.
- Keep business logic out of React components.
- Use typed models and validation schemas.
- Add tenantId and userId to all tenant-owned records.
- Never log credentials, resumes, sensitive profile data, or application answers.
- Do not invent user experience in generated resumes or answers.
- Pause on uncertain or sensitive application fields.
- Do not bypass CAPTCHA, rate limits, or anti-bot systems.
- Add audit logs for important user, AI, and browser-agent actions.
- Run typecheck/build/tests before reporting completion.
- Commit after each completed phase.

## Build Order

Phase 1:
- Auth-ready app shell
- Tenant-aware data model
- User profile setup
- Resume upload
- Resume parsing placeholder
- Editable career profile
- Basic dashboard shell

Phase 2:
- Offline job ingestion workers
- Greenhouse connector
- Lever connector
- Normalized job schema
- Deduplication

Phase 3:
- Match engine
- Score jobs from 0 to 10
- Apply Review Queue
- Maybe Queue
- Browse Queue
- Low-score summaries

Phase 4:
- Dashboard actions
- Application tracker
- Generate tailored application package

Phase 5:
- Playwright browser application assistant
- Human approval gate before submit

Phase 6:
- Evals, feedback events, model/prompt versioning, usage metering, admin dashboard