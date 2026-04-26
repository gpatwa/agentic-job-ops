# QA Evidence — <slice name>

> Owner: QA Evidence Agent
> Status: <draft / ready for security>
> Source diff: <commit SHA(s)>

## Commands run

In order. Record actual output (tail at minimum).

| # | Command | Result | Notes |
|---|---------|--------|-------|
| 1 | `npm run typecheck` | pass / fail | <tail> |
| 2 | `npx vitest run <file>` | pass / fail | <tail> |
| 3 | `npm test` | pass / fail | <tail> |
| 4 | `npm run build` | pass / fail | <tail> |
| 5 | `npm run qa:mvp` (or pack equivalent) | pass / fail | <tail> |
| 6 | `git diff --check` | pass / fail | — |

## UI verification

For each state listed in the UX spec, evidence of the state rendering:

| Screen | State | Evidence | Notes |
|--------|-------|----------|-------|
| <screen> | empty | screenshot / snapshot | — |
| <screen> | loading | screenshot / snapshot | — |
| <screen> | error | screenshot / snapshot | — |
| <screen> | success | screenshot / snapshot | — |

Console errors / warnings observed: <none, or list>

## Safety invariant verification

For each invariant the slice touches:

| Invariant | Verification | Result |
|-----------|--------------|--------|
| `<from .agentic/SAFETY_INVARIANTS.md>` | `<test/eval/inspection>` | pass / fail |

## Deferred / skipped

| Item | Why deferred | Owner |
|------|--------------|-------|
| <item> | <reason> | <agent or human> |

## Recommendation

- [ ] Pass to Security & Privacy Agent
- [ ] Block — return to <agent> for <reason>

## Hand off

Next agent: Security & Privacy Agent.
