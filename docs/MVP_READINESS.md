# MVP Readiness

## Product Promise

Agentic Job Ops helps an individual job seeker move from resume to reviewed application decisions faster. The AI finds and ranks jobs, prepares reviewable application materials, and highlights next actions. The human stays in control of approvals and final submission.

Core principle: the AI does the work. The human makes the decision.

## Target User

The MVP is B2C-first for individual job seekers who want less setup, fewer forms, and more automation in a focused job search workflow.

Primary user:
- Has a resume.
- Wants role recommendations and apply-ready job suggestions.
- Wants draft application materials they can inspect and edit.
- Wants browser-assistant help only after approving a package.

## Core B2C Happy Path

1. Start from a clean workspace or use the clearly labeled realistic demo.
2. Add or paste a resume.
3. Run resume intelligence and review parsed profile facts.
4. Confirm target roles and search positioning.
5. Review apply-ready jobs in Action Center and Job Matches.
6. Start application prep for a strong match.
7. Review and edit the tailored resume, cover letter, and short answers.
8. Approve or reject the application package.
9. Start browser apply from an approved package.
10. Review detected fields, fill plan, uncertain fields, and safety pauses.
11. Explicitly approve submit only after final human review.
12. Track applications and follow-ups in Applications.

## Safety Invariants

- No application can be submitted without explicit human approval.
- Autopilot has no blind auto-apply path.
- Browser apply starts only from an approved package.
- Submit requires the same approved browser session and a recorded approval event.
- CAPTCHA, login challenges, sensitive demographic fields, unknown required fields, and low-confidence answers pause for the user.
- Application records move to submitted only after confirmed assistant submission or explicit manual submitted action.
- Generated application content must not invent experience, metrics, tools, companies, degrees, or credentials.
- Demo data is clearly labeled as demo and must not be confused with real user data.

## Manual QA Checklist

- Clean workspace opens Onboarding by default.
- Onboarded workspace opens Action Center by default.
- Try realistic demo seeds labeled demo data and routes to Action Center.
- Job Matches show scored Apply Review, Maybe, and Browse jobs.
- Low-score jobs remain browsable with explanations.
- Application packages are editable and reviewable.
- Approve and reject package flows update status correctly.
- Browser apply demo shows adapter/fill-plan status and blocked submit behavior.
- Tracker links to packages and browser sessions.
- No visible copy implies blind submit or auto-apply.
- Clear local workspace works in dev/demo cleanup.

## Known Limitations

- The current app uses local workspace storage, not production persistence.
- Auth, billing, production tenant administration, and RBAC are not complete.
- Real external submit remains disabled by default.
- Greenhouse and Lever adapter infrastructure is fixture/dry-run oriented for MVP validation.
- LLM adapters are placeholders; deterministic fallbacks power the local flow.
- Job ingestion is limited to configured sources and manual URL placeholders.
- Company and recruiter intelligence is deterministic or estimated unless explicitly integrated later.

## Not In MVP

- Blind auto-apply.
- Live external submission by default.
- CAPTCHA solving or anti-bot evasion.
- B2B coach, university, bootcamp, or enterprise dashboards.
- Delegated approval on behalf of a job seeker.
- Production payment plans, seat management, or billing.
- Full production backend migration.
- Automated outreach sending.
- Unsupported resume claims or fabricated application answers.

## Future B2B Roadmap

B2B remains future roadmap, not MVP scope. Later B2B work may include:

- Coach, university, bootcamp, and outplacement dashboards.
- Multi-job-seeker workspaces.
- RBAC and delegated review policies.
- Tenant-level reporting, audit exports, and usage controls.
- Program-level outcome analytics.
- Enterprise procurement, billing, SSO, and compliance controls.

## Launch Blockers

- Approval-gate tests must remain green.
- Demo happy path must work from a clean workspace.
- Browser submit must remain blocked without explicit approval.
- Generated package warnings must remain visible.
- Tracker must not show submitted unless the user explicitly marks manual submitted or a confirmed approved assistant submission exists.
- No B2B implementation should be exposed as MVP functionality.
- Build, typecheck, tests, and `git diff --check` must pass before launch candidate tagging.
