# Local Commands — Agentic Job Ops

> The exact commands an agent runs locally. Keep this file accurate;
> agents rely on it.

---

## Read before doing anything

```
agentic-sdlc/docs/OPERATING_MODEL.md   ← targeted tests first, full QA before commit
.agentic/SAFETY_INVARIANTS.md          ← the invariants you must not break
```

---

## Type checking

```
npm run typecheck
```

Run after any change. `tsc --noEmit`. Must pass before commit.

---

## Tests

### Targeted (run first while iterating)

```
npx vitest run tests/<file>.test.ts
```

Fast feedback. Use this while you're still working through the
implementation.

### Full suite (run before commit)

```
npm test
```

`vitest run` over every test file. Must pass before commit.

---

## Build

```
npm run build
```

`tsc --noEmit && vite build`. Must pass before commit.

---

## Local regression — the MVP gate

```
npm run qa:mvp
```

This is the **main local regression gate**. It runs typecheck + full
test suite + build in a single sequence. The QA Evidence Agent runs
this before handing off to Security.

> If `qa:mvp` is not yet defined in `package.json`, run the three
> commands above in order: `npm run typecheck && npm test && npm run build`.

---

## Lint / whitespace

```
git diff --check
```

Catches whitespace / merge-marker issues. Must pass before commit.

---

## Git status / diff

```
git status
git diff --stat <files>
git log --oneline -5
```

Use to confirm the diff is what you intend before committing.

---

## Browser preview

```
.claude/launch.json defines the dev server (vite-dev on port 5174).
```

Use the `mcp__Claude_Preview__*` tools to verify UI changes:

- `preview_list` to find the running server.
- `preview_screenshot` for visual evidence.
- `preview_snapshot` for accessibility-tree evidence.
- `preview_eval` for hash-route navigation
  (`window.location.hash = '<route>'`).
- `preview_console_logs` with `level: "error"` to confirm no new
  runtime errors.

The dev server is reused if already running. Don't start a second one.

---

## Commit format

One commit per slice. Title under 70 characters, imperative mood. Body
covers what changed and why. Include the safety co-author footer:

```
<title>

<2-6 sentences on what changed and why>

Co-Authored-By: <model> <noreply@anthropic.com>
```

Use a heredoc when the body has multiple lines:

```
git commit -m "$(cat <<'EOF'
<title>

<body>

Co-Authored-By: ...
EOF
)"
```

---

## What NOT to run

- `git push --force`
- `git reset --hard`
- `git commit --no-verify`
- `git rebase` on published commits
- Anything destructive without explicit human approval per
  `agentic-sdlc/docs/HUMAN_APPROVAL_RULES.md`.
