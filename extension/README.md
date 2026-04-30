# Agentic Job Ops — Browser Extension (v0.2)

A Chrome MV3 extension that fills Greenhouse + Lever job application
forms inline on the candidate's actual browser tab. **It never
auto-submits.** The candidate reviews every fill and clicks Submit
themselves.

> The AI does the work. The human makes the decision.

## How it works

```
+------------------------------------------------+
|  http://localhost:5173  (Agentic dashboard)    |
|  ┌────────────────────────────────────────┐    |
|  │ dashboardBridge.js (content script)    │    |
|  │  - listens for window.postMessage      │    |
|  │  - stores synced profile in            │    |
|  │    chrome.storage.local                │    |
|  └────────────────────────────────────────┘    |
+------------------------------------------------+
            |                       |
   chrome.storage.local      chrome.storage.local
   (sync-v1)                 (saved-answers-v1)
            |                       |
+------------------------------------------------+
|  https://job-boards.greenhouse.io/...          |
|  ┌────────────────────────────────────────┐    |
|  │ pill.js (content script)               │    |
|  │  - renders "Apply with Agentic" pill   │    |
|  │  - reads sync from chrome.storage      │    |
|  │  - fills inputs (React-aware setter)   │    |
|  │  - captures unmapped answers           │    |
|  │  - "Fill & advance" multi-page mode    │    |
|  │  - HARD STOP at Submit button          │    |
|  └────────────────────────────────────────┘    |
+------------------------------------------------+
```

## Install (dev mode)

1. Run the dashboard locally: `npm run dev` (Vite on :5173).
2. Open `chrome://extensions/`, turn on **Developer mode**, click
   **Load unpacked**, select this `extension/` folder.
3. Refresh `http://localhost:5173/` — the
   "Apply now in your browser" card on the Browser Assistant page
   should flip from "Install extension" to "Sync to extension".
4. Click **Sync to extension** on any active package.
5. Open the actual application URL (Greenhouse / Lever).
6. Click the floating **Apply with Agentic** pill bottom-right.
7. Review every field, attach your resume manually, click Submit
   yourself.

## What gets injected where

| File | Where it runs | Purpose |
|---|---|---|
| `manifest.json` | — | MV3 manifest, content_scripts auto-injection |
| `src/dashboardBridge.js` | localhost:5173 / 127.0.0.1:5173 | postMessage broker between dashboard ↔ chrome.storage |
| `src/pill.js` | `*.greenhouse.io`, `jobs.lever.co`, `*.lever.co` | Floating pill + fill engine |
| `src/background.js` | service worker | Message routing for the legacy app-driven flow (used by Browser Assistant demo) |
| `src/contentScript.js` | (programmatic only) | Legacy page-structure extractor for the dashboard demo |

## Hard rules (enforced structurally)

| Rule | Where |
|---|---|
| Never click submit | `pill.js` has no `.submit()` call, asserted by `tests/extensionPill.test.ts`. The `Fill & advance` mode rejects any page with a visible Submit button via `looksLikeSubmitPage()`. |
| Never bypass CAPTCHA | `looksLikeSubmitPage()` doesn't try to advance past CAPTCHA pages; the pill banner tells the user to solve it manually. |
| Never fill credentials | `tryFill()` rejects `type=password`, `type=hidden`, `type=file`. |
| Never read credentials | The extension has no access to password fields, cookies, or other tabs. `host_permissions` is scoped to localhost (dashboard sync) and Greenhouse/Lever only. |
| Never call any server | All data lives in `chrome.storage.local` on the user's machine. No `fetch`, `XMLHttpRequest`, or `sendBeacon` in `pill.js`. |

## Features

### One-click form fill

Click the **Apply with Agentic** pill on a Greenhouse / Lever
application page. The pill reads the synced profile and fills:

- First Name, Last Name, Full Name (split from `fullName`)
- Email, Phone, Location
- LinkedIn, GitHub, Portfolio / Website URLs
- Visa sponsorship select (when text matches)
- Custom textarea questions matched by associated label

Filled fields get a 2px emerald outline. A floating banner shows the
count + the reminder to attach your resume manually.

### "Save this answer once, reuse forever"

After fill, the pill watches every textarea you type into. If the
field has a derivable label and isn't a standard contact field, a
**Save to Agentic library** chip appears below the input. Click it to
capture `{question: <label>, answer: <value>}` into
`chrome.storage.local`.

On your next dashboard visit, click **Pull saved answers** on the
Browser Assistant card — captured answers merge into your
`SavedApplicationAnswer` library and auto-fill on every future form
that asks the same question (case + punctuation collapsed for
matching).

### Fill & advance (Manus-pattern click-to-takeover)

Toggle **Fill & advance multi-page** on the pill. After fill, if a
Continue / Next button is found AND no Submit button is visible:

- A floating banner shows a 5-second countdown.
- Click anywhere on the page → cancel auto-advance and take over.
- Countdown ends → pill clicks Continue, waits for the next page,
  re-fills.
- Repeats until a Submit button appears, then **stops** so you click
  Submit yourself.

This is the same UX Manus's local Browser Operator made famous —
adapted to our hard rules. No server-side browser, no credit costs,
no anti-bot bypass.

## Privacy

- Synced profile values + saved answer captures live in
  `chrome.storage.local` on your machine. They never leave the
  extension.
- The pill content script can ONLY read DOM on the current tab
  (manifest `host_permissions` is scoped to Greenhouse / Lever +
  localhost).
- The dashboardBridge content script ONLY accepts messages from the
  same window with `source: "agentic-dashboard"`. Cross-origin
  messages are ignored.

## Tests

- `tests/extensionPill.test.ts` — loads `pill.js` into jsdom and
  exercises the fill engine, structural safety properties, library
  merging, and Continue / Submit detection.
- `tests/browserExtensionBridge.test.ts` — exercises the
  dashboard-side `postMessage` round-trip and saved-answer pull / merge.

Run with `npm test`.
