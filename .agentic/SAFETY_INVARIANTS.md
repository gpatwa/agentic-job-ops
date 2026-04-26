# Safety Invariants — Agentic Job Ops

> Hard invariants that MUST hold across every release. Verified by the
> QA Evidence Agent and the Security & Privacy Agent on every slice.
> Weakening one of these requires explicit human approval per
> `agentic-sdlc/docs/HUMAN_APPROVAL_RULES.md`.

---

## 1. No submit without explicit human approval

**Invariant:** No code path causes an application to be submitted to a
real ATS without the human having approved that specific submission.

**Why:** Submitting the wrong application under the user's name is
unrecoverable.

**Where enforced:**
- `src/services/browserApplicationAssistant.ts` —
  `submitApprovedBrowserApplication` requires `submit_approved` event
  in the session.
- `src/services/autopilotService.ts` — `autopilotCanSubmit()` returns
  `false` constant; no code path delegates to a submit.

**Eval coverage:**
- `eval_autopilot_cannot_submit`
- `eval_autopilot_submit_approval_cannot_be_disabled`

---

## 2. Autopilot cannot submit

**Invariant:** Autopilot has no submit code path. It can prepare,
schedule, and recommend, but it cannot send.

**Why:** Autopilot is the most automation-heavy surface. The blast
radius of a bug there must be bounded.

**Where enforced:**
- `autopilotCanSubmit()` is a constant `false`.
- `requireApprovalBeforeSubmit` is `z.literal(true)` in
  `src/models/schemas.ts` and rejected at the service boundary in
  `saveAutopilotSettings`.

---

## 3. Browser assistant cannot submit without approval

**Invariant:** The browser application assistant requires an explicit
`approveBrowserSubmit` call before `submitApprovedBrowserApplication`
can run.

**Where enforced:**
- `src/services/browserApplicationAssistant.ts`.

**Eval coverage:** browser assistant safety suite.

---

## 4. Extension cannot submit without approval

**Invariant:** The extension session moves through typed states; the
final submit transition requires `submitApprovedAt` to be set, which
only the user can trigger.

**Where enforced:**
- `src/services/extensionService.ts` —
  `recordExtensionSubmitCompleted` requires `submit_approved` first.

---

## 5. Page-structure hash must match before fill

**Invariant:** If the page structure hash on the active page differs
from the hash recorded in the fill plan, the fill is refused.

**Why:** Sites change. A fill plan generated for one DOM must not
silently run against a different DOM.

**Where enforced:**
- `src/services/extensionService.ts` — `approveExtensionFill` and
  `recordExtensionFieldsFilled` cross-check the hash.

---

## 6. No CAPTCHA / anti-bot bypass

**Invariant:** No code in this project solves CAPTCHAs, spoofs browser
fingerprints, or evades rate limits. CAPTCHA detection pauses the
session and surfaces it to the user.

**Why:** Bypass is both an ethical line and a legal one.

---

## 7. Demo data is clearly labeled

**Invariant:** Any demo / seeded record carries a clear label that
distinguishes it from real user data, both in the UI and in the
underlying record metadata.

**Why:** Demo data that looks real is a footgun for the user and for
the audit log.

---

## 8. No invented user-facing claims

**Invariant:** The system does not fabricate values the user might rely
on — resume bullets, recruiter names, salary numbers, dates,
credentials, demographic answers. When source data is missing, the
system says "not provided" or "unknown".

**Where enforced:**
- `src/services/resumeImprovementService.ts` — defense-in-depth checks
  for invented metrics, fake credentials, fake employer names.
- `src/services/recruiterCrmService.ts` —
  `safeRecruiterFirstName` returns `""` when no real first name is
  available; salutation falls back to `"Hi team"`.
- Application package eval suite — `eval_package_no_fake_claims`,
  `eval_package_fake_claim_checker`.

---

## 9. No sensitive values logged

**Invariant:** The system never logs full resume text, full application
answers, recruiter contact info, demographic fields, credentials, or
any other PII / sensitive content. Logs use IDs, lengths, and content
hashes.

**Where checked:**
- Security Agent grep on every slice.
- No `console.log` of fields like `profile.fullName`, `profile.email`,
  `resume.parsedText`, `applicationAnswer.answer`.

---

## 10. Adapter boundary placeholders throw

**Invariant:** Every LLM-adjacent capability has a placeholder adapter
that throws with a message naming the adapter. Tests run without API
keys.

**Where enforced:**
- `PlaceholderLlmOutreachAdapter` in
  `src/services/recruiterCrmService.ts`.
- `PlaceholderLlmIntelligenceAdapter` in
  `src/services/intelligenceService.ts`.
- (Add new placeholders to this list when new adapters are introduced.)

---

## 11. Audit events for every state-changing automated action

**Invariant:** Every automated action that changes state the user can
inspect emits an audit event with `generationMode` and the relevant
resource IDs.

**Where checked:**
- Tech spec audit-event list ↔ diff cross-check by Security Agent.

---

## 12. Avoided companies always block package preparation

**Invariant:** Companies on the user's avoid list never produce an
application package. Autopilot cannot override this. The user can
override the high-risk-signal block per run, but never the avoid-list
block.

**Where enforced:**
- `src/services/careerOpsService.ts` and
  `src/services/autopilotService.ts`.

**Eval coverage:**
- `eval_autopilot_avoided_company_blocks_package_prep`.
