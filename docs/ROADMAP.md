# Roadmap

## MVP Scope: B2C

The MVP is B2C only. It is built for an individual job seeker who wants a fast, resume-first workflow:

- Resume-first onboarding.
- Resume intelligence and ATS parse quality checks.
- Target role recommendations.
- Apply-ready job recommendations.
- Job ingestion and deterministic match scoring.
- Action Center for user decisions.
- Application package generation with review/edit/approve workflow.
- Browser application assistant foundation in dry-run/review mode.
- Application tracker, recruiter follow-up reminders, and basic company intelligence.
- Evals, feedback events, usage metering, and admin/system visibility for quality checks.

The MVP success metric is not raw application volume. It is stronger-fit, truthful, human-approved applications with clear user control.

## Near-Term B2C Hardening

- Keep the realistic demo happy path fast and reliable.
- Tighten copy around human approval and browser-assistant limits.
- Improve local-to-production data migration plan.
- Expand deterministic eval coverage for package truthfulness and submit guardrails.
- Add more fixture coverage for ATS forms while keeping live external submit disabled by default.
- Improve Action Center prioritization and tracker clarity.

## Post-MVP B2C

- Production auth and account management.
- Persistent backend storage and migrations.
- Real model-backed adapters behind existing deterministic fallbacks.
- More ATS adapters and safer browser-assistant validation.
- Better job-source management and source health visibility.
- Outcome analytics focused on recruiter responses and interviews.
- User-controlled preferences for sensitive fields where legally and ethically appropriate.

## Future Scope: B2B

B2B is future roadmap, not MVP implementation.

Future B2B may include:

- Coach, university, bootcamp, outplacement, and enterprise dashboards.
- Multi-candidate views and progress summaries.
- RBAC, delegated review, and explicit delegated approval policy.
- Tenant-level audit exports and usage controls.
- Program-level reporting for outcomes and conversion.
- SSO, billing, procurement, compliance, and admin governance.

## Always Out Of Scope

- Blind auto-apply.
- CAPTCHA solving or anti-bot evasion.
- Hidden background submission.
- Submitting on behalf of a job seeker without explicit approval.
- Fabricated work history, metrics, skills, companies, degrees, certifications, or demographic answers.
