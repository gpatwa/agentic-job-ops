# AI Service Architecture

The Agentic Job Ops AI surface (resume intelligence, future job analysis, future cover-letter generation) sits behind a small backend boundary so the OpenAI / Azure OpenAI API key never reaches the browser bundle. The same architecture works locally (Node + Vite dev server + .env file) and in Azure production (Azure App Service + Static Web Apps + Key Vault), with deterministic fallback when no provider is reachable.

## Goals

- Keep the OpenAI key server-side. Never ship it in the JS bundle.
- Same code path in local dev and in Azure production.
- Frontend gracefully degrades to deterministic when the API is offline.
- Tests run without a network round-trip and without an API key.
- Every approval gate (package review, browser apply submit) stays in front of the LLM-generated artefacts.

## High-level shape

```
┌─────────────────────┐    HTTPS     ┌─────────────────────┐    HTTPS     ┌─────────────────────┐
│   Browser (React)   │ ───────────▶ │  AI API Server      │ ───────────▶ │  OpenAI API         │
│   localhost:5173    │              │  Node, port 8787    │              │  Azure OpenAI       │
│                     │ ◀─── JSON ── │                     │ ◀─── JSON ── │                     │
└─────────────────────┘              └─────────────────────┘              └─────────────────────┘
        │                                     │                                    
        │ deterministic fallback if           │ deterministic fallback if          
        │ /api/* unreachable                  │ provider call throws               
        ▼                                     ▼                                    
        in-process                            in-process                           
        deterministic                         deterministic                        
        adapter                               adapter
```

The "AI API Server" is a tiny Node HTTP server in [`server/`](../server) that does only three things: validate requests, dispatch to a provider implementation, redact + log structurally. There is intentionally no framework or ORM — the server should stay small enough to audit in one sitting.

## Local flow

```
.env                     server (tsx server/index.ts)        Vite dev (npm run dev:web)
─────                    ─────────────────────────────       ─────────────────────────────
OPENAI_API_KEY=sk-…   →  hydrateEnvFromFile() loads          /api/* requests proxied to
AI_PROVIDER=openai       OPENAI_API_KEY into process.env  →  http://127.0.0.1:8787 via
WEB_ORIGIN=…             AI provider = openai                vite.config.ts proxy rule
                         CORS allow = WEB_ORIGIN
```

Run both processes together: `npm run dev` (uses `concurrently` to spin up `dev:web` and `dev:api` side by side). The frontend API client (`src/services/resumeIntelligenceApiClient.ts`) calls `POST /api/resume-intelligence`; if the server is offline it returns `ApiResumeIntelligenceUnavailableError` and the API-backed adapter falls back to the in-process deterministic adapter — the user sees the deterministic source badge and analysis still works.

## Azure production flow

```
Cloudflare CDN          Azure Static Web App        Azure App Service             OpenAI / Azure OpenAI
─────────────────       ─────────────────────       ──────────────────             ──────────────────────
www.example.com  →      static React bundle    →    Node API server          →    api.openai.com
                        (no secrets)                (reads secrets from
                                                     Azure Key Vault via
                                                     identity binding)
                                                     CORS = WEB_ORIGIN
                                                     (Static Web App URL)
```

Notes:

- **Secrets at runtime, never in source.** The same env vars (`OPENAI_API_KEY`, `AZURE_OPENAI_*`) are populated by Azure Key Vault references on App Service ("Key Vault references" feature). The server reads them from `process.env` exactly like in local dev — no SDK calls into the secret store from this codebase.
- **Static Web App handles the bundle**, App Service handles the API. The two are joined by Static Web App's "linked backend" pattern OR by configuring CORS on the API to allow the Static Web App origin. Either works; pick whichever your tenant prefers. The `WEB_ORIGIN` env var controls the CORS allowlist.
- **Cloudflare in front** is optional and orthogonal — it just terminates TLS and caches static assets. Don't put the API behind a cache.
- **Logging** routes to Azure Monitor / Application Insights; the JSON-line log format from `server/index.ts` is already structured for ingestion.

## Environment variables

Defined in [`.env.example`](../.env.example). All values are server-side; nothing here is exposed to the bundle.

| Variable | Purpose | Required when |
|---|---|---|
| `AI_PROVIDER` | Override provider selection (`openai` / `azure_openai` / `deterministic`). | optional — auto-detected from credentials when blank. |
| `OPENAI_API_KEY` | OpenAI public API key. | `AI_PROVIDER=openai` (or auto-selected). |
| `OPENAI_RESUME_MODEL` | Model name for resume analysis. | optional, defaults to `gpt-4.1-mini`. |
| `OPENAI_JOB_MODEL` | Reserved for future job-side adapters. | optional. |
| `AZURE_OPENAI_ENDPOINT` | `https://<resource>.openai.azure.com`. | `AI_PROVIDER=azure_openai`. |
| `AZURE_OPENAI_API_KEY` | Azure OpenAI subscription key. | `AI_PROVIDER=azure_openai`. |
| `AZURE_OPENAI_API_VERSION` | API version (e.g. `2024-08-01-preview`). | optional, defaults to `2024-08-01-preview`. |
| `AZURE_OPENAI_RESUME_DEPLOYMENT` | Azure deployment name pointing at a chat-completions model. | `AI_PROVIDER=azure_openai`. |
| `AZURE_OPENAI_JOB_DEPLOYMENT` | Reserved for future job-side adapters. | optional. |
| `API_PORT` | Server bind port. Defaults to `8787`. | optional. |
| `WEB_ORIGIN` | CORS allowlist for the AI server. Defaults to `http://localhost:5173`. | always set in prod to the deployed Static Web App URL. |

## Key Vault guidance

For Azure App Service:

1. Create a Key Vault, add secrets `openai-api-key` (and Azure variants if used).
2. Enable a system-assigned managed identity on the App Service.
3. Grant the identity `get`/`list` on the Key Vault secrets.
4. In App Service Configuration, set the env vars to Key Vault references, e.g. `@Microsoft.KeyVault(SecretUri=…)`.
5. Restart the App Service. The values surface via `process.env` exactly like a literal value would.

The server code does not import any Key Vault SDK — Azure injects the resolved values transparently. This keeps the same code path working in local dev (where the values come from `.env`) and in production.

## CORS

The server is restrictive by default:

- `Access-Control-Allow-Origin: <WEB_ORIGIN>` (single value, not `*`).
- `Access-Control-Allow-Methods: GET, POST, OPTIONS`.
- `Access-Control-Allow-Headers: Content-Type` only — no `Authorization` (the browser must not send any).
- Preflights cached for 10 minutes.

In Azure, set `WEB_ORIGIN` to the Static Web App URL. Don't set it to `*` — the API has no per-user auth in this MVP.

## Logging + redaction rules

Hard rules enforced by [`server/security/redaction.ts`](../server/security/redaction.ts):

- **No raw resume text** in log lines. The `redactForLog` helper collapses `resumeText` / `coverLetter` / `answers` keys to `[redacted-user-content len=N]`.
- **No API keys / bearer tokens.** The same helper redacts string values that look like secrets (`sk-…`, long base64-ish runs, `Bearer …`) regardless of which key they're under.
- **No request or response bodies** are passed through `console.log` directly. Only structural fields are emitted (text length, target-role count, status code, duration).
- **Errors are passed through `redactErrorForLog`** which strips `sk-…` and `Bearer …` substrings before they hit stdout.

The single allowed log function in [`server/index.ts`](../server/index.ts) is `logRequest()` which always produces single-line JSON suitable for Azure Monitor / Application Insights ingestion.

## Fallback behaviour

Three layers of fallback:

1. **Server primary → server fallback.** If the configured LLM provider throws (network, 5xx, schema validation), the route handler in [`server/routes/resumeIntelligenceRoute.ts`](../server/routes/resumeIntelligenceRoute.ts) automatically retries with the deterministic provider and sets `fallbackUsed: true` in the response.
2. **Server response → frontend deterministic.** If the API returns 5xx anyway, or the response body is malformed, the frontend's API-backed adapter (`createApiBackedResumeIntelligenceAdapter` in `src/services/resumeIntelligenceService.ts`) catches the `ApiResumeIntelligenceUnavailableError` and runs the deterministic adapter in-process.
3. **API offline → frontend deterministic.** If the entire API server is unreachable (e.g. only `dev:web` is running), step 2 still kicks in.

The UI source badge always reflects what actually ran (`OpenAI LLM` / `Azure OpenAI` / `deterministic fallback`).

## Test strategy

Three layers of tests, with progressively higher cost:

| Layer | Scope | Runs in `npm test`? | Runs in `qa:mvp`? | Network? | API key? |
|---|---|:-:|:-:|:-:|:-:|
| Unit tests | redaction, env, provider selection, route handlers, frontend client + fallback | ✓ | ✓ | ✗ | ✗ |
| E2E tests | Playwright happy path: paste resume → analyze → start prep → approve → browser apply (submit blocked) | ✓ (via `test:e2e`) | ✓ | ✗ | ✗ |
| Live LLM tests | Real OpenAI call, schema validation against real model output | ✗ | ✗ | ✓ | ✓ |

Run live LLM tests opt-in:

```sh
# Loads .env into the shell, then runs only *.llm.test.ts
export $(grep -v '^#' .env | grep '=' | xargs) && npm run test:llm
```

The opt-in test (`tests/openai.live.llm.test.ts`) skips itself unless **both** `OPENAI_API_KEY` is set **and** `RUN_LLM_TESTS=1` (which the `test:llm` script sets). This double guard keeps it from accidentally firing in CI when an env var slips through.

`npm run qa:mvp` is the canonical local regression check. It must pass without any LLM credentials; the e2e Playwright spec uses `dev:web` (only Vite, no API server) and the deterministic fallback to keep the happy path fully offline.

## Approval gates remain unchanged

This service handles **analysis** only. The browser apply assistant, package review approval, and the `submit-blocked-message` gate are untouched. The LLM never receives the user's submit decision; it only produces drafts the human reviews.
