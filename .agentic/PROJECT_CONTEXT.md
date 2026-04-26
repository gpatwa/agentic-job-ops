# Project Context — Agentic Job Ops

> This file is read by every agent at the start of every slice. Keep it
> tight and current. If something here is stale, fix it before starting
> the next slice.

## What this product is

Agentic Job Ops is a B2C AI job application platform. The user uploads
their resume; the system finds matching jobs, prepares tailored
application packages, and helps the user submit those applications
through a browser assistant — with the human approving every external
action.

## Who it serves

Individual job seekers. One human, one workspace, one AI co-pilot.

## Current focus

**B2C MVP.** B2B coach / mentor / university dashboards are deferred
to the future roadmap and are NOT in scope for any current slice.

## Core principle

The AI does the work. The human makes the decision.

Concretely:

- Less setup. Less forms. More automation.
- Resume-first onboarding. The user uploads / pastes a resume and
  reaches value within a few clicks.
- The Action Center is the primary home after onboarding. It lists the
  small set of decisions the user actually needs to make today.
- Human approval on every external action that affects the user.
  Always.

## Product surface (today)

- Onboarding: resume upload → resume intelligence → target role
  recommendations → confirm → first apply-ready jobs.
- Job ingestion + scoring + match queues.
- Application packages (deterministic, with placeholder LLM adapter).
- Browser application assistant + extension safety foundations + real-
  site dry-run validation.
- Career Ops scheduled runs.
- Company / recruiter intelligence.
- Recruiter CRM and follow-up agent.
- B2C Autopilot + Action Center.

## What's NOT this product

- B2B coach / mentor dashboards.
- University / institutional dashboards.
- Blind auto-apply.
- Live external submit without explicit user approval.
- Bypassing CAPTCHA, rate limits, or anti-bot systems.
- Filling sensitive demographic fields without user-saved defaults.

## Project archetype

This is both a **B2C SaaS** product (`project-packs/b2c-saas.md`) and an
**AI agent product** (`project-packs/ai-agent-product.md`) and a
**browser automation product** (`project-packs/browser-automation-product.md`).
All three packs apply. The browser automation pack is the strictest;
its rules win where they conflict.

## Tech shape

- TypeScript + React + Vite + Tailwind on the frontend.
- Service layer in `src/services/` — business logic lives here, not in
  React components.
- Persistence today: localStorage scoped by tenant + user
  (`ajo:${tenantId}:${userId}:${resource}`).
- Persistence ready: Prisma schema in `prisma/schema.prisma` mirrors
  the localStorage shape so DB-backed deployment is a future slice,
  not a rewrite.
- Tests: vitest. Targeted runs first, then `npm test` for the full
  suite.

## Where to look

- `CLAUDE.md` — project instructions (CLAUDE-only conventions).
- `src/models/domain.ts` — type definitions for everything.
- `src/models/schemas.ts` — Zod schemas matching the domain types.
- `src/services/` — service implementations.
- `src/pages/` — route-level pages.
- `src/components/` — shared components.
- `tests/` — vitest test files.
- `prisma/schema.prisma` — future-DB schema mirror.
