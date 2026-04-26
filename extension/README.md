# Agentic Job Ops — Local Browser Extension Foundation (Phase 9)

This folder is the **Phase 9 foundation** for a local browser extension that lets the Agentic Job Ops assistant inspect a user-authorized job application page and safely fill fields the user has explicitly approved.

It is intentionally minimal and aligned with the project's core safety rule:

> The AI does the work. The human makes the decision.
> No application can be submitted without explicit human approval.

## What this is

- A Manifest V3 Chrome extension scaffold.
- A content script that extracts a normalized, value-redacted page structure.
- A service worker that orchestrates messages between popup, content script, and (in production) the local app.
- A popup UI that lets the user explicitly authorize a page before any inspection happens.
- A local demo HTML application page for end-to-end manual testing.

## What this is *not*

- Not blind auto-apply.
- Not a CAPTCHA bypass — CAPTCHA, login challenges, and demographic questions always pause for the user.
- Not a credential store — passwords, hidden authentication fields, and cookies are never read or sent.
- Not a live external submitter — submit only happens through the app's approval gate.

## Folder layout

```
extension/
├── manifest.json           Manifest V3 manifest with minimal permissions
├── README.md               This file
├── src/
│   ├── background.js       Service worker; orchestrates messages
│   ├── contentScript.js    Page introspection + safe fill execution
│   ├── popup.html          Popup UI shell
│   ├── popup.js            Popup logic (connect, extract, fill)
│   └── types.ts            Shared TypeScript types (documentation; mirrors
│                           the app-side ExtensionPageStructure / message
│                           contract)
└── demo/
    └── demo-application.html  Local fixture application page
```

## Permissions

The manifest requests the absolute minimum:

- `activeTab` — inspect only the tab the user explicitly clicks the action on.
- `scripting` — inject the content script on user click.
- `storage` — remember the active connected tab between popup opens.
- `host_permissions` for `http://127.0.0.1:5174` and `http://localhost:5174` — the local Agentic Job Ops dev server.

There is no broad host permission, no `cookies` permission, no `webRequest`, no `declarativeNetRequest`, and no remote endpoints.

## Loading the extension in Chrome (manual)

1. Run the app: `npm run dev` (the extension expects `http://127.0.0.1:5174/`).
2. Open `chrome://extensions/`.
3. Toggle **Developer mode** on.
4. Click **Load unpacked** and select this `extension/` folder.
5. Pin the extension so the action button is visible.

## Trying the demo flow

1. Open the demo fixture in a tab: drag `extension/demo/demo-application.html` into Chrome (or open via `file://`).
2. Click the extension's action button. The popup opens.
3. Click **Connect to active tab**. This is the explicit user authorization step. Until you click, no page inspection happens.
4. Click **Read page structure**. The popup shows the field count and the captured fields.
5. Click **Fill safe fields**. Demo placeholder values populate the safe (non-sensitive, non-file, non-select, non-checkbox) inputs. CAPTCHA, demographic, and password-like fields are skipped.
6. The popup also includes a **Disconnect** button to drop the session.

The demo intentionally never submits. Even the demo's submit button is wired to a no-op.

## Production wiring (later phases)

The current foundation runs the popup-driven flow locally. The end-to-end production loop will be:

1. Extension popup → background → content script (already wired).
2. Background → app: POST normalized page structure to the local app's extension ingest endpoint.
3. App: runs `ingestExtensionPageStructure` then `createExtensionFillPlan` (see [src/services/extensionService.ts](../src/services/extensionService.ts)) to produce a safe fill plan.
4. User reviews the plan inside the app and approves fill via `approveExtensionFill`.
5. App → extension: forward the approved fill plan items.
6. Extension content script writes the approved values.
7. User reviews the page, then approves submit via `approveExtensionSubmit` inside the app.
8. App emits a persisted `user_approved_extension_submit` audit log.
9. Extension content script triggers submit (only when the user is on the page); it then reports back, and the app calls `recordExtensionSubmitCompleted`. That call **rejects** unless the persisted approval audit exists and the actor is the job seeker; on rejection it emits `extension_submit_blocked`.

The state machine and every guard live in [src/services/extensionService.ts](../src/services/extensionService.ts) and are covered by [tests/extensionService.test.ts](../tests/extensionService.test.ts).

## State machine (mirrors the app)

```
extension_not_connected
  ↓ user clicks the extension action
awaiting_user_authorization
  ↓ user explicitly authorizes
connected
  ↓ extension sends page structure
page_analyzed
  ↓ app creates fill plan via ATS adapter
fill_plan_ready
  ↓ user approves fill in the app
fill_approved
  ↓ extension fills safe fields and reports back
fields_filled  →  ready_for_final_review
  ↓ user reviews and approves submit in the app
submit_approved
  ↓ extension confirms submit
submitted
```

Side states:

- `disconnected` — user disconnected the session.
- `manual_required` — CAPTCHA, login, or low-confidence pause; user takes over.
- `failed` — adapter or runtime error; application status is never advanced.

## Safety contract (enforced in `src/services/extensionService.ts`)

- The fill plan is created by the existing ATS adapter layer; it returns `dry_run` previews only.
- Approve fill (`approveExtensionFill`) and approve submit (`approveExtensionSubmit`) require the explicit `approvedByUser: true` flag and reject any actor other than the job seeker.
- `recordExtensionSubmitCompleted` checks: session belongs to the current tenant and user → actor is the job seeker → status is `submit_approved` → a persisted `user_approved_extension_submit` audit exists for this session, authored by the job seeker, before the submit attempt → if a linked `applicationPackageId` is present, the package is still `approved` → no captcha or login pause remains. Any failure persists an `extension_submit_blocked` audit and rejects.
- A captcha or login pause at the fill-plan stage routes the session to `manual_required` immediately.

## What is intentionally NOT included

- No build system / bundler. Manifest V3 + Chrome run plain JS files directly.
- No real network call from the extension to the app. The Phase 9 foundation runs the user-authorized inspection and demo fill locally; the bridge into the app is documented above and represented by the app-side service contract.
- No automated browser-runtime test of the extension itself. The app-side state machine is fully tested in [tests/extensionService.test.ts](../tests/extensionService.test.ts).

## Future work

- Wire a small local fetch endpoint (or `window.postMessage` bridge) so the extension can deliver page structures to the app and receive fill plans without copy/paste.
- Replace the demo placeholder fill values with the app-supplied approved plan items.
- Add a Playwright-driven extension smoke test against the demo page.
