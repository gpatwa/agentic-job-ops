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

## Phase 3 Outcomes

- Deterministic match scoring from 0 to 10 without API keys.
- Placeholder LLM scoring adapter boundary for later model-backed scoring.
- Queue routing into Apply Review, Maybe, and Browse.
- Skip recommendations remain searchable in Browse.
- Explanations include summary, match reasons, gaps, employer needs, and recommended next action.
- Manual scoring action for development and testing.

## Phase 4 Outcomes

- Dashboard actions for saving, rejecting, archiving, queue movement, prep placeholders, note taking, and manual application status.
- Application tracker records created or updated from user actions.
- Tracker grouped by application status with manual status and note edits.
- User overrides logged without deleting jobs.
- Phase 5 application package generation prepared behind a service boundary.

## Phase 5 Outcomes

- Start application prep generates a reviewable application package.
- Packages include a tailored resume draft, concise cover letter draft, and editable short-answer drafts.
- Deterministic generation works without LLM keys through a swappable adapter boundary.
- Generated content uses profile, parsed resume text, verified facts, and job descriptions only.
- Unsupported-claim warnings flag risky company, tool, credential, and metric mentions.
- Users can edit, approve, or reject packages; no application is submitted.

## Phase 6 Outcomes

- Approved packages can start a browser application assistant session.
- Browser sessions detect an ATS placeholder, detect fields, fill safe fields from approved user-controlled sources, and pause on uncertain or sensitive fields.
- CAPTCHA, login challenges, sensitive demographic questions, low-confidence required fields, and final submit stay under human control.
- The job seeker must explicitly approve submit before any assistant submit action can run.
- Application records move to submitted only after confirmed assistant submission or an explicit manual submitted action.
- Real Playwright automation remains behind an adapter boundary.

## Phase 7 Outcomes

- Feedback events capture major job, package, browser, and outcome decisions.
- Usage metering records operational events by tenant without storing sensitive content.
- Deterministic eval suites verify match-score calibration, package truthfulness, and browser assistant safety guardrails.
- AI output metadata centralizes model, prompt, version, mode, and hash fields for scoring, package generation, answers, and browser field detection.
- Application outcomes track recruiter responses, interviews, rejections, offers, withdrawals, and submitted applications.
- Admin visibility summarizes jobs ingested, jobs scored, packages generated, browser sessions, applications submitted, feedback, usage, evals, audit activity, and recent failures.
- Product optimization stays focused on strong-fit, truthful, human-approved applications rather than raw application volume.

## Users

- Individual job seekers.
- Career coaches and teams supporting multiple job seekers.
- Universities, bootcamps, outplacement firms, and enterprise programs.

## Later Outcomes

- Backend tenant isolation and persistence.
- RBAC and delegated-approval policy for coaches and admins.
- Production billing and plan-based usage controls.
- Real browser automation behind the existing approval gate and safety checks.
