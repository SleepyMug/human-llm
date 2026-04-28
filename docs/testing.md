# Testing

Three layers, each with one tool.

## Unit tests — Vitest

Lives next to the code it tests, named `*.test.ts(x)`.

- `packages/server`: pure logic (queue state machine, id generation,
  SSE writer helpers). Vitest runs in a Node environment.
- `packages/web`: React components, rendered with
  `@testing-library/react`. Vitest runs in `jsdom`.
- `packages/shared`: type-only, so no runtime tests; `tsc --noEmit` in
  CI catches breakage.

Run with `npm test -w @human-llm/server` etc., or `npm test` at the
root to run all workspace test scripts.

## Integration tests — Vitest + `fastify.inject`

Server-only, in `packages/server/test/`. Hits Fastify in-process via
`app.inject()`, no real network. Covers:

- Non-streaming `POST /v1/chat/completions` end-to-end against a fake
  human submission.
- Streaming `POST /v1/chat/completions` — assert SSE frames in order,
  ending with `data: [DONE]`.
- Internal API state transitions (`/claim`, `/respond`, `/cancel`)
  including 409 / 404 paths.

## End-to-end tests — Playwright

Lives in `tests/e2e/` at the repo root, with `playwright.config.ts` at
the root. Drives a real Chromium browser against a real server.

Setup (configured in `playwright.config.ts`):

- Two `webServer` entries: `npm run dev -w @human-llm/server` (Fastify
  via `tsx watch`) and `npm run dev -w @human-llm/web` (Vite dev
  server). Playwright boots both in parallel before any test runs and
  tears them down after.
- `WEB_PORT` and `HUMAN_LLM_SERVER_PORT` env vars are forwarded to
  Vite so its `/api` and `/v1` proxies hit the right Fastify port.
- `baseURL` points at the Vite dev URL.
- Default browser is Chromium; Firefox and WebKit can be enabled per
  project block when needed.

Test scenarios (one `*.spec.ts` per scenario, all in `tests/e2e/`):

1. **`happy-path.spec.ts`** — fire `POST /v1/chat/completions` from
   the test using Playwright's `request` fixture; the request appears
   in the UI list, the human claims it, types a reply, submits; the
   original (held) HTTP call resolves with a `chat.completion` body
   carrying the human reply.
2. **`streaming.spec.ts`** — same flow with `stream: true`. Uses
   raw `fetch` so the SSE response body can be read incrementally.
   Asserts the chunk sequence: an initial `role: "assistant"` delta,
   one or more content deltas (the human's reply lands in one),
   a `finish_reason: "stop"` chunk with empty delta, then `data:
   [DONE]`. Asserts shared `id`, `model`, and `object:
   "chat.completion.chunk"` across all chunks.
3. **`cancellation.spec.ts`** — two cases:
   - API client `AbortController.abort()` while the request is still
     `pending` → server's `reply.raw` close handler cancels the queued
     request → SSE `request.cancelled` reaches the browser → row
     disappears.
   - Same, but the human had already claimed it → row disappears
     **and** the toolbar shows the "cancelled by the API client"
     banner.
4. **`multi-session.spec.ts`** — `browser.newContext()` twice. Both
   pages see the request. Context A clicks claim first; Context B's
   row flips to `claimed` and the button is disabled. Context B
   issues a direct `POST /api/requests/:id/claim` with a different
   sessionId via `ctxB.request` and gets `409`. Context A submits to
   resolve the held HTTP call cleanly.

Tests run in parallel (`fullyParallel: true`, default workers). Each
test tags its request with a unique marker in the user message
(`freshMarker(prefix)` in `tests/e2e/helpers.ts`) and locates its UI
row via `:has-text(MARKER)` so concurrent tests don't collide on the
shared queue. Tests also wait for the SSE connection status to flip
to "Connected" before firing API calls, to avoid losing the
`request.created` event in the gap between hydrate and SSE open.

Why Playwright at the repo root rather than inside `packages/web`:
e2e tests exercise the full stack (real server + real browser), so
they don't belong to either package. Keeping the config at the root
also means a single `npx playwright test` invocation runs the whole
suite.

## CI shape (future)

A single CI job runs:

1. `npm ci`
2. `npm run typecheck` (each workspace's `tsc --noEmit`)
3. `npm test` (all workspace vitest suites)
4. `npx playwright install --with-deps chromium`
5. `npx playwright test`

CI is not configured in the planning task — see the follow-up issue
for CI setup.
