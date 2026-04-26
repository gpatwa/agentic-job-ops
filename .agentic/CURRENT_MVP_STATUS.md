# Current MVP Status — Agentic Job Ops

> Snapshot of where the B2C MVP stands today. Update this file when a
> phase lands or scope shifts. Stale snapshots are worse than no
> snapshot.

Last updated alongside Phase 16 + the agentic-sdlc playbook polish.

---

## What ships today (B2C MVP)

| Capability | Status | Source |
|------------|--------|--------|
| Resume-first onboarding | Shipped | OnboardingPage + onboardingJobRecommendationService |
| Resume intelligence + ATS parse check | Shipped | resumeIntelligenceService |
| Resume improvement loop | Shipped | resumeImprovementService |
| Resume-based target recommendations | Shipped | resumeIntelligenceService |
| Apply-ready job recommendations during onboarding | Shipped | onboardingJobRecommendationService |
| Job ingestion (Greenhouse, Lever) | Shipped | atsAdapters + jobIngestion |
| Match scoring | Shipped | matchEngine |
| Application packages (deterministic) | Shipped | applicationPackage |
| Browser application assistant | Shipped | browserApplicationAssistant |
| Extension safety foundations | Shipped | extensionService |
| Real-site dry-run validation | Shipped | realSiteDryRunService |
| Career Ops scheduled runs | Shipped | careerOpsService |
| Company / recruiter intelligence | Shipped | intelligenceService |
| Recruiter CRM + follow-up agent | Shipped | recruiterCrmService |
| B2C Autopilot + Action Center | Shipped | autopilotService + ActionCenterPage |
| Simplified B2C navigation + onboarding-aware default home | Shipped | App.tsx route + AppShell |
| Realistic B2C demo seed | Shipped | demo seed service + Action Center CTA |
| MVP readiness + happy-path QA documentation | Shipped | docs/MVP_READINESS.md, docs/QA_HAPPY_PATH.md |
| Automated MVP happy-path QA | Shipped | `npm run qa:mvp` (typecheck + tests + build + e2e) |
| Agentic SDLC playbook + project adapter | Shipped | agentic-sdlc/ + .agentic/ |

---

## What's queued

Nothing in flight at the moment. The next slice is up to the Orchestrator
to scope from the launch-blocker list below or from a new product
direction.

---

## What is NOT in the MVP

These are **deferred to the future roadmap**, not in any current slice:

- B2B coach / mentor dashboards.
- University / institutional dashboards.
- Multi-tenant admin surfaces (RBAC UI, audit log export, SSO).
- Live external submit without explicit user approval (this is a
  permanent invariant, not a deferred feature).
- Auto-fill of sensitive demographic fields.

See `agentic-sdlc/project-packs/enterprise-saas-future.md` for the
shape of the future B2B / enterprise direction.

---

## Known limitations

- Persistence is localStorage-scoped. The Prisma schema is shaped for
  PostgreSQL and is kept current alongside the localStorage shape, but
  no live DB is wired.
- LLM adapters are placeholders that throw. Tests run without keys; no
  real model is called from this build.
- Job ingestion uses Greenhouse + Lever only. No LinkedIn / Indeed /
  Workday / Ashby in this build.
- Browser assistant operates against fixtures. Real-site dry-run
  produces snapshots; live submit is gated by approval and currently
  exercised against demo flows only.

---

## Launch blockers (for first real B2C release)

To go from "MVP code complete" to "first real B2C release", these must
be resolved:

- [x] Phase 16 (MVP readiness) lands.
- [x] `npm run qa:mvp` script is defined locally
      (`typecheck && test && build && test:e2e`). CI wiring still TBD.
- [x] `docs/MVP_READINESS.md` and `docs/QA_HAPPY_PATH.md` exist.
- [x] Demo seed flow lands and is clearly labeled.
- [ ] `npm run qa:mvp` runs green in CI on every push to `main`.
- [ ] All twelve safety invariants in `.agentic/SAFETY_INVARIANTS.md`
      pass their named eval / inspection check on a clean workspace.
- [ ] One additional independent QA pass on a clean workspace by an
      agent that did not implement the slice.

---

## What an Orchestrator should do with this file

When invoked for a new slice, the Orchestrator reads this file to
understand:

- What's already shipped (don't re-build).
- What's deferred (don't pull in).
- What the active queue is (don't conflict).
- What blocks first release (prioritise these when choices come up).

When a slice lands, the implementing engineer (or the Release Manager)
updates the relevant row.
