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
packages/web/
  index.html
  vite.config.ts
  src/
    main.tsx             # mount React, build the store, attach to #root
    App.tsx              # top-level layout, hydrate + SSE + handlers
    api/
      client.ts          # fetch wrappers for /api endpoints (claim/respond/cancel)
      events.ts          # EventSource subscription -> store.dispatch({ event })
    components/
      RequestList.tsx    # left-hand pending list
      RequestView.tsx    # right-hand conversation + reply box
      Toolbar.tsx        # session info, connection state, banner
    state/
      reducer.ts         # pure (state, action) -> state, plus initialState()
      store.ts           # createStore() factory + useStore() hook
    session.ts           # sessionId generator (persisted in sessionStorage)
    styles.css
    test-setup.ts        # @testing-library/jest-dom setup for vitest
```

No router needed for v1 — single page is enough. The store is a tiny
factory around `useReducer`-style logic exposed via
`useSyncExternalStore` so non-React modules (the SSE subscriber) can
dispatch without props drilling. We have not pulled in zustand; the
abstraction is small enough to keep in-tree.

## Dev server

`vite` in dev with a proxy for `/api` and `/v1` to
`http://localhost:8080` (the Fastify server). The proxy target is
configurable via `HUMAN_LLM_SERVER_PORT` and the web port via
`WEB_PORT`. The Playwright config boots both server and web before
running e2e tests; see [`../testing.md`](../testing.md).

## State model

Local store, keyed by request id:

```ts
type WebState = {
  sessionId: string;
  connection: "connecting" | "open" | "closed";
  requests: Record<string, PendingRequest>;
  claimedId: string | null;
  banner: string | null;
};
```

Action types:

- `connection { status }` — SSE open/close transitions.
- `hydrate { requests }` — initial `GET /api/requests` payload; drops
  any already-terminal entries.
- `event { event }` — a parsed SSE frame; the reducer dispatches by
  `event.type` (see below).
- `claim/optimistic { id }` — set `claimedId` before the server has
  confirmed, so the right pane switches immediately.
- `claim/failed { id }` — clear `claimedId` if the network call
  rejects (e.g., a 409 because another session beat us to it).
- `release/local` — clear `claimedId` after a successful submit or
  decline so the right pane returns to the empty state without waiting
  for the SSE round-trip.
- `banner/clear` — dismiss the cancellation banner.

Reducer behavior on each SSE event:

- `request.created` → add to `requests`. (Terminal-state payloads are
  ignored as a defensive guard.)
- `request.claimed` → update `state` and `claimedBy`. If we held a
  local `claimedId` for this request and the winning `claimedBy` is
  not us, drop our local claim (lost the race).
- `request.completed` / `request.cancelled` → drop from `requests`. If
  the dropped id was our `claimedId`, also clear `claimedId`. For
  cancellations of a request we held, set `banner` so the human knows
  the API client gave up.

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

- Unit (`packages/web/src/**/*.test.{ts,tsx}`, run via
  `npm test -w @human-llm/web`):
  - `state/reducer.test.ts` — every action transition: hydrate filter,
    claim race resolution, completed/cancelled drops, banner
    bookkeeping.
  - `session.test.ts` — `getSessionId` mints and persists a stable id.
  - `components/Toolbar.test.tsx`, `RequestList.test.tsx`,
    `RequestView.test.tsx` — rendered with React Testing Library +
    `@testing-library/jest-dom`. Cover the empty state, claim flow,
    Cmd/Ctrl+Enter submit, decline, and error display.
- e2e: Playwright drives a real browser against the running server.
  See [`../testing.md`](../testing.md) for the test infrastructure.
