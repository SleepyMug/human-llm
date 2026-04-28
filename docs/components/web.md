# Web UI (`packages/web`)

A minimal Vite + React + TypeScript app. The whole UI is a single
page: the human sees a list of pending requests on the left, picks
one, and types a response on the right.

## Responsibilities

- Subscribe to `GET /api/events` on load and keep a local list of
  requests in sync.
- Let the human claim a pending request (`POST .../claim`).
- Render the conversation (`messages[]`) for the claimed request.
- Submit the typed response (`POST .../respond`) or cancel
  (`POST .../cancel`).
- Generate a stable `sessionId` per browser tab so the server can
  release claims if the tab closes.

## Layout

```
packages/web/src/
  main.tsx           # mount React
  App.tsx            # top-level layout
  api/
    client.ts        # fetch wrappers for /api endpoints
    events.ts        # EventSource subscription + reducer
  components/
    RequestList.tsx  # left-hand pending list
    RequestView.tsx  # right-hand conversation + reply box
    Toolbar.tsx      # session info, connection state
  state/
    store.ts         # small reducer/store (zustand or useReducer)
  session.ts         # sessionId generator (persisted in sessionStorage)
  styles.css
  index.html
```

No router needed for v1 — single page is enough.

## Dev server

`vite` in dev with a proxy for `/api` and `/v1` to
`http://localhost:8080` (the Fastify server). The Playwright config
boots both server and web before running e2e tests; see
[`../testing.md`](../testing.md).

## State model

Local store, keyed by request id:

```ts
type WebState = {
  sessionId: string;
  connection: "connecting" | "open" | "closed";
  requests: Record<string, Request>;
  claimedId: string | null;
};
```

Reducer handles each SSE event:

- `request.created` → add to `requests`.
- `request.claimed` → update `claimedBy` and clear from another tab if
  it was ours.
- `request.completed` / `request.cancelled` → drop from `requests`.

On reload, fetch `GET /api/requests` first to populate the store, then
open the SSE stream — events received during the gap are replayed by
the server (see queue design). For v1 the gap window is small enough
that we can accept lost events and rely on the page-load fetch.

## Accessibility / UX notes

- The reply box must be keyboard-friendly: `Cmd/Ctrl+Enter` submits.
- Show the inbound model name and any non-empty `metadata` so a human
  can tell if the request had `temperature: 0` or a system prompt.
- When a request is `cancelled` from under the human (API client
  disconnected), surface a banner and clear the right-hand pane.

## Tests

- Unit: components rendered with React Testing Library + vitest.
- e2e: Playwright drives a real browser against the running server.
  See [`../testing.md`](../testing.md) for the test infrastructure.
