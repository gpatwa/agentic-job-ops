# Product Analytics Plan

## Purpose

This plan defines the B2C MVP activation funnel and product events for Agentic Job Ops. The MVP is local and not production-deployed yet, so this is an instrumentation plan and naming reference, not a deployment task.

Analytics must respect the core product principle: the AI does the work, the human makes the decision.

## Activation Funnel

1. Workspace started.
2. Resume added or realistic demo seeded.
3. Resume intelligence completed.
4. Target roles confirmed.
5. Apply-ready jobs shown.
6. First job reviewed.
7. Application package started.
8. Application package approved.
9. Browser apply started.
10. Submit approval gate reached or submit blocked before approval.
11. Tracker viewed.

## Key Product Events

Use these names as canonical product analytics events for the MVP funnel.

| Event | When It Fires | Notes |
| --- | --- | --- |
| `workspace_started` | User opens a clean local workspace or first app session starts. | No resume/profile content in payload. |
| `demo_seed_started` | User clicks Try realistic demo. | Include whether non-demo data required confirmation. |
| `demo_seed_completed` | Demo seed finishes and routes to Action Center. | Include counts only: jobs, matches, packages, actions. |
| `resume_uploaded` | User uploads, pastes, or creates a resume record. | Do not include resume content. |
| `resume_intelligence_completed` | Resume intelligence report is created. | Include risk level, warning count, missing field count. |
| `target_roles_confirmed` | User confirms selected target roles. | Include role count, not full role text unless user consent exists. |
| `apply_ready_jobs_shown` | Apply-ready recommendations are visible. | Include counts by queue. |
| `first_job_reviewed` | User opens or acts on the first recommended job. | Include job source and queue, not private notes. |
| `application_package_started` | User starts application prep. | Equivalent to prep workflow start. |
| `application_package_approved` | User approves a reviewable package. | Approval of content only, not submission. |
| `browser_apply_started` | User starts browser apply from an approved package. | Include adapter type and dry-run/fill-only mode. |
| `submit_blocked_before_approval` | Submit attempt or submit path is blocked before explicit approval. | Safety event. Include reason code only. |
| `tracker_viewed` | User opens Applications tracker. | Include counts by status. |

## Existing Event Mapping

Current local services already record many related audit, feedback, and usage events. Map them into analytics aliases when production analytics is added.

| Analytics Event | Existing Local Signal |
| --- | --- |
| `resume_uploaded` | usage event `resume_uploaded` |
| `resume_intelligence_completed` | audit/usage event `resume_intelligence_completed` |
| `target_roles_confirmed` | feedback/usage event `job_target_recommendations_confirmed` or `onboarding_target_roles_selected` |
| `apply_ready_jobs_shown` | feedback/usage event `onboarding_jobs_recommended` |
| `first_job_reviewed` | audit event `onboarding_job_review_started` |
| `application_package_started` | audit event `application_prep_started` |
| `application_package_approved` | feedback event `application_package_approved` |
| `browser_apply_started` | feedback/usage event `browser_session_created` or usage event `browser_session_started` |
| `submit_blocked_before_approval` | audit event `browser_submit_blocked` with reason metadata |

Events not yet consistently emitted as analytics events:
- `workspace_started`
- `demo_seed_started`
- `demo_seed_completed`
- `tracker_viewed`

These should be added only when product analytics instrumentation is introduced.

## Metrics

### Activation

- Time to first apply-ready job: workspace start to `apply_ready_jobs_shown`.
- Onboarding completion rate: workspaces reaching target confirmation and apply-ready jobs.
- Job review rate: users with `first_job_reviewed` divided by users with `apply_ready_jobs_shown`.
- Package start rate: users with `application_package_started` divided by users with reviewed jobs.
- Package approval rate: approved packages divided by packages started.
- Browser apply start rate: browser apply starts divided by approved packages.
- Approval gate reached rate: sessions reaching ready-for-review divided by browser apply starts.

### Safety And Trust

- Submit blocked before approval count.
- Unsupported-claim warning rate per package.
- Manual-required browser session rate.
- Low-confidence answer rate.
- Rejected package rate.

### Outcome Quality

- Recruiter response rate.
- Interview conversion rate.
- Offer rate.
- Withdrawn/rejected distribution.

Do not optimize for raw number of submitted applications.

## Event Payload Guidance

Allowed payload examples:
- Counts.
- Status names.
- Queue names.
- Adapter type.
- Risk level.
- Warning count.
- Boolean flags such as demo mode.
- Time deltas.

Avoid payload examples:
- Resume text.
- Cover letter text.
- Application answers.
- Phone, email, address, exact salary, or precise location.
- Browser page contents.
- Sensitive demographic answers.
- Credentials, tokens, CAPTCHA data, or login state.

## Privacy Notes

- Analytics should be event-based and content-minimizing.
- Local/demo data should be labeled with `demo: true`.
- Sensitive profile fields should never be copied into analytics payloads.
- Browser assistant events should store reason codes and counts, not raw field values.
- Admin/System summaries should remain useful without exposing private content.
- Users should understand that final submit always requires explicit approval.
