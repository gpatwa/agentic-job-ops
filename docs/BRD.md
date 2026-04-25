# Business Requirements Document

## Purpose

Agentic Job Ops is an enterprise SaaS platform for job search operations where AI performs research and preparation while the human approves consequential actions.

## Core Principle

The AI does the work. The human makes the decision. The product must not submit job applications without explicit user approval.

## Phase 1 Outcomes

- Auth-ready application shell with tenant context.
- Profile setup and editable career profile.
- Resume upload record with a parsing placeholder.
- Dashboard surfaces for Apply Review, Maybe, Browse, and Application Tracker.
- Tenant-aware data model for future PostgreSQL storage.
- Audit log helper for important actions without sensitive content.

## Phase 2 Outcomes

- Configurable job sources for Greenhouse and Lever public company boards.
- Manual, daily, and every 6 hours scan cadence settings.
- Manual scans that normalize postings into one job schema.
- Deduplication so repeated scans do not repeatedly insert the same jobs.
- Scan history with errors visible to operators.
- New jobs held in queued status for Phase 3 scoring.

## Users

- Individual job seekers.
- Career coaches and teams supporting multiple job seekers.
- Universities, bootcamps, outplacement firms, and enterprise programs.

## Later Outcomes

- Offline job ingestion from Greenhouse, Lever, APIs, and crawlers.
- Match scoring from 0 to 10.
- Tailored resume and cover letter generation from verified facts only.
- Browser-based application assistant with a human approval gate before submit.
- Evals, feedback loops, tenant isolation, RBAC, audit logs, and metering.
