# MVP Friction Log

Use this log during UX audits, user tests, and internal happy-path QA. Copy the table into a dated section for each session.

## Severity

- P0: Safety, privacy, trust, or approval-gate blocker.
- P1: Happy-path blocker or severe comprehension issue.
- P2: Polish, copy, layout, or conversion friction.

## Status

Suggested statuses:
- New
- Triaged
- In progress
- Fixed
- Won't fix
- Needs retest

## Friction Table

| Date | Tester | Page | User goal | Expected behavior | Actual behavior | Friction | Severity | Suggested fix | Screenshot/link | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| YYYY-MM-DD | Name | Onboarding | Try realistic demo | Demo seed creates clearly labeled local data and routes to Action Center. |  |  | P0/P1/P2 |  |  | New |

## Session Notes

### Session: YYYY-MM-DD

Tester:

Environment:

Starting route:

Demo or real data:

Summary:

Top issues:

Retest needed:

### Session: 2026-04-26

Tester: Codex local audit

Environment: Local Vite app at `http://127.0.0.1:5174`, demo workspace, commit `4ded407`

Starting route: `#autopilot-settings`, reset to clean workspace through `Clear local workspace`

Demo or real data: Realistic demo seed

Summary: Automated QA passed before the manual audit. The first-time B2C happy path completed from clean workspace through demo seed, Action Center, Job Matches, application package approval, browser apply demo, Tracker, and Admin/System audit visibility. No P0 safety issues were found. Submit remained blocked before explicit approval.

Top issues: Duplicate Action Center actions, ambiguous package-prep CTAs when a package already exists, fragmented deterministic package draft bullets, dense Tracker layout, and technical copy in review surfaces.

Retest needed: Retest after P1 fixes for Action Center deduplication, package CTA clarity, deterministic package draft quality, and Tracker layout clarity.

| Date | Tester | Page | User goal | Expected behavior | Actual behavior | Friction | Severity | Suggested fix | Screenshot/link | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-04-26 | Codex local audit | Action Center | Understand the next decisions waiting after demo seed | Each real decision appears once and is easy to prioritize. | Two identical high-urgency `[Demo] Application package ready to review` actions appeared. | Duplicate high-priority actions make the main home feel noisy and can make users wonder whether there are two packages or a sync bug. | P1 | Deduplicate Action Center actions by package/application identity and show a single package-review task per application. | Manual browser audit note | New |
| 2026-04-26 | Codex local audit | Job Matches | Decide what to do with a high-match job | If an application package already exists, the primary CTA should be `Review package` or clearly explain regeneration. | The same job card showed both `Start application prep` and `Review package`; clicking prep opened the existing package. | Users may hesitate because it is unclear whether prep will regenerate, overwrite, or duplicate existing work. | P1 | Make package-aware job card actions stateful: show `Review package` as primary and move regeneration behind explicit copy if needed. | Manual browser audit note | New |
| 2026-04-26 | Codex local audit | Application Package | Review a tailored resume draft with confidence | Generated bullets should read as complete, polished, evidence-backed statements. | The resume draft included sentence fragments such as `- and customer success on launch readiness.` and `- and customer interviews to prioritize product work.` | Fragmented bullets undermine trust in the generated package and require cleanup before approval. | P1 | Tighten deterministic package generation to preserve complete source bullets and add a regression test for fragment-only bullets. | Manual browser audit note | New |
| 2026-04-26 | Codex local audit | Tracker | Understand application status and next action | Tracker should emphasize application state, package link, browser session state, notes, and next action. | Recruiter CRM controls appeared inline under each tracked application and dominated the page. | The page feels heavier than the MVP task and makes the core tracker state harder to scan. | P1 | Collapse Recruiter CRM into a secondary panel or details disclosure by default. | Manual browser audit note | New |
| 2026-04-26 | Codex local audit | Job Matches | Understand the recommended next step for a job | Recommended next action should reflect the current queue and application status. | Apply Review jobs still said `move this job to Apply Review for human decision.` | The recommendation feels stale because the job is already in that queue. | P2 | Make recommended-next-action copy queue-aware and status-aware. | Manual browser audit note | New |
| 2026-04-26 | Codex local audit | Application Package | Understand that package approval succeeded | After approval, the page should make the approved state clear and avoid redundant approval actions. | `Package Approved` appeared, but the `Approve` button remained visible. | Users may wonder whether approval worked or whether another approval is required. | P2 | Hide or disable the approval button after approval and replace it with the next safe action. | Manual browser audit note | New |
| 2026-04-26 | Codex local audit | Application Package | Focus on reviewing user-facing content | The review page should prioritize content, warnings, and next actions. | Technical metadata (`Generation`, `Model`, `Prompt`, `Input hash`, `Output hash`) appeared near the top of the page. | The primary B2C review path feels more internal than necessary. | P2 | Move metadata behind an expandable details section. | Manual browser audit note | New |
| 2026-04-26 | Codex local audit | Browser Assistant | Understand the dry-run adapter result | Browser assistant status should be clear in user-facing terms. | The page showed overlapping technical labels such as `ATS Greenhouse`, `Adapter Greenhouse`, and `Greenhouse-Ats-Adapter`. | Adapter jargon may distract from the important safety and review state. | P2 | Use one concise label for the detected application system and hide adapter class naming. | Manual browser audit note | New |
| 2026-04-26 | Codex local audit | Resume | Trust the resume preview and data handling | Resume preview should be paired with clear local/demo/privacy context. | The resume text preview displayed contact details and full demo resume text without a nearby privacy reminder. | Real users may wonder how uploaded resume data is stored, logged, or used. | P2 | Add concise local/demo privacy copy near the resume preview and link to trust/safety details when available. | Manual browser audit note | New |
| 2026-04-26 | Codex local audit | Admin/System | Review audit visibility | Audit and usage should be visible but understandable. | Event names appeared in system-style wording such as `Ats Adapter Run` and `uncertain field detected`. | The advanced page is functional, but the terminology still reads like an internal console. | P2 | Keep Admin/System advanced, but group event names with friendlier labels and raw names in details. | Manual browser audit note | New |
