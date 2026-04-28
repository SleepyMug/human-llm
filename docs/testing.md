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

- `webServer` entries boot the Fastify server and the Vite dev server
  before any test runs, and tear them down after.
- `baseURL` points at the Vite dev URL.
- Default browser is Chromium; Firefox and WebKit can be enabled per
  project block when needed.

Test scenarios to cover (split across follow-up issues):

1. **Smoke** — page loads, shows the empty state when no requests are
   pending. (This one ships with the planning task as a sanity check
   that Playwright is wired up correctly.)
2. **Happy path** — fire an OpenAI-style HTTP call from the test
   itself, see the request appear in the UI, claim it, type a reply,
   submit; assert that the original HTTP call resolves with the right
   content.
3. **Streaming** — same flow with `stream: true`; assert SSE frames
   land in the API client.
4. **Cancellation** — API client disconnects; the UI clears that
   request.
5. **Multi-session** — two browser contexts; only one can claim a
   given request.

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
