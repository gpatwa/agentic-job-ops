# Product Requirements Specification

## Phase 1 Scope

Build a clean enterprise SaaS foundation with:

- Landing/dashboard home.
- Profile setup page.
- Resume upload page.
- Career profile review/edit page.
- Job dashboard with empty Apply Review, Maybe, and Browse queues.
- Application tracker page.

## Functional Requirements

- Users can create and edit a career profile.
- Users can upload a resume record or create a clearly labeled placeholder upload.
- Users can view placeholder parsed resume text.
- Dashboard shows profile completion, resume status, empty queues, tracker status, and recent audit activity.
- All tenant-owned records include `tenantId` and `userId`.

## Non-Functional Requirements

- Use TypeScript.
- Keep business logic in services and helpers, not React components.
- Use validation schemas for domain records.
- Do not log resume content, sensitive profile data, credentials, or application answers.
- Preserve a service boundary for ingestion, matching, AI generation, and browser-agent workflows.
- Require human approval before any future application submission.
