# UX Audit Scorecard

## Audit Purpose

This scorecard evaluates whether Agentic Job Ops delivers a clear, trustworthy B2C MVP experience for an individual job seeker. The goal is to identify friction in the local happy path before production work begins.

Core principle: the AI does the work. The human makes the decision.

This audit must not recommend blind auto-apply, live external submit, CAPTCHA bypass, hidden submission, or weakened approval gates.

## Core B2C Happy Path

1. Start clean workspace.
2. Try realistic demo or add resume.
3. Review resume intelligence.
4. Confirm target roles.
5. See apply-ready jobs.
6. Review job match reasons and gaps.
7. Start application package prep.
8. Review, edit, approve, or reject package.
9. Start browser apply demo from approved package.
10. Confirm submit is blocked until explicit approval.
11. Track application and follow-up state.
12. Review safety/audit visibility in Admin/System.

## Scoring Rubric

Use a 1 to 5 score for each category.

- 5: Excellent. Clear, fast, polished, and trustworthy with no material friction.
- 4: Good. Works well with minor copy, layout, or flow issues.
- 3: Acceptable. User can complete the task, but friction or confusion is likely.
- 2: Weak. Flow is technically possible but confusing, slow, brittle, or untrustworthy.
- 1: Failing. User is blocked, misled, or exposed to a safety/privacy concern.

## Categories

### First Impression

Questions:
- Does the first screen make the product promise obvious?
- Does a new user understand what to do next within 10 seconds?
- Is the local/demo state clearly labeled?
- Does the UI feel like a job seeker product, not an internal engineering console?

Pass guidance:
- Clear primary action.
- No internal phase language.
- No cluttered advanced controls in the primary path.

### Onboarding

Questions:
- Is resume-first onboarding obvious?
- Does "Try realistic demo" clearly explain that it creates demo data?
- Can the user recover or clear local demo data?
- Does the flow reduce setup instead of asking for too many fields?

Pass guidance:
- User reaches the next useful step without needing documentation.
- Non-demo user data is not overwritten without confirmation.

### Resume Intelligence

Questions:
- Are extracted facts easy to scan and verify?
- Are ATS risk and parsing warnings understandable?
- Are missing or ambiguous fields handled without shame or alarm?
- Does the experience avoid claiming certainty where evidence is weak?

Pass guidance:
- User knows what was learned from the resume and what still needs review.

### Job Recommendations

Questions:
- Do Apply Review, Maybe, and Browse feel distinct?
- Are low-score jobs still visible with useful explanations?
- Are match reasons and gaps specific enough to support a decision?
- Are demo jobs clearly labeled as demo?

Pass guidance:
- User can confidently choose review, save, prep, reject, or browse.

### Action Center

Questions:
- Does Action Center feel like the main home after onboarding?
- Are actions prioritized around human decisions?
- Are final submit approvals visually and verbally distinct?
- Can the user complete or dismiss non-critical actions without confusion?

Pass guidance:
- The user sees a short, decision-oriented list, not a generic dashboard.

### Application Package Review

Questions:
- Are resume, cover letter, and short answers reviewable and editable?
- Is package status clear?
- Are safety warnings visible and actionable?
- Does approval feel like approval of content, not application submission?

Pass guidance:
- User understands that approving a package enables browser assistant prep, not blind submit.

### Browser Apply Safety

Questions:
- Can browser apply start only from an approved package?
- Is the session state clear?
- Are uncertain, sensitive, CAPTCHA, login, and final submit gates visible?
- Is submit blocked before explicit approval?
- Does the UI avoid implying live external submit is enabled by default?

Pass guidance:
- A tester can prove submit remains blocked until explicit human approval.

### Tracker Clarity

Questions:
- Are applications grouped by meaningful status?
- Does tracker distinguish draft/prep/review/approved/submitted/manual-required?
- Are package and browser session links easy to find?
- Does submitted copy cover manual and approved assistant submission correctly?

Pass guidance:
- User can answer "what happens next?" for every tracked application.

### Trust And Privacy

Questions:
- Is sensitive data handling explained in plain language?
- Does the product avoid logging resume content or application answer text?
- Are demo data and real data clearly separated?
- Are audit, feedback, usage, and eval summaries understandable without exposing private content?

Pass guidance:
- User can trust the product without reading source code.

### Copy Clarity

Questions:
- Is language user-facing instead of implementation-facing?
- Are "AI", "assistant", "autopilot", and "browser apply" terms used consistently?
- Are safety limits framed as user control, not product failure?
- Are CTAs specific and action-oriented?

Pass guidance:
- No visible copy mentions internal phases, parser/crawler future work, or hidden implementation details.

## Severity Levels

- P0: Safety, privacy, or trust blocker. Example: submit possible without explicit approval, real data overwritten without confirmation, or unsupported generated claims presented as fact.
- P1: Happy-path blocker or severe confusion. Example: user cannot reach Action Center, cannot open a package, or cannot understand package status.
- P2: Polish or conversion friction. Example: unclear button label, weak empty state, visual clutter, or low-priority copy issue.

## Pass/Fail Guidance

MVP audit passes when:
- No P0 issues are open.
- No P1 issues block the documented happy path.
- Average score across categories is 4.0 or higher.
- Browser submit remains blocked without explicit approval.
- Demo data is clearly labeled.
- The user can complete the B2C happy path without engineering help.

MVP audit fails when:
- Any P0 issue is open.
- More than two P1 issues are open.
- Average score is below 3.5.
- The product appears to optimize for raw application volume over truthful, strong-fit, user-approved applications.
