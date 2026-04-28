# Architecture

`human-llm` has three logical pieces:

1. **Server** (`packages/server`) — a Fastify HTTP server that exposes
   the OpenAI-compatible API on the front and an internal API on the
   back. Holds the in-memory queue of pending requests.
2. **Web UI** (`packages/web`) — a Vite + React app that humans open in
   a browser to see pending requests and type responses.
3. **Shared** (`packages/shared`) — TypeScript types shared between
   server and web (OpenAI request/response shapes, internal events,
   request lifecycle).

## End-to-end request flow

```
   OpenAI client                     Server                        Human (browser)
        │                              │                               │
        │ POST /v1/chat/completions    │                               │
        ├─────────────────────────────►│ enqueue request (id=R)        │
        │                              │ ── SSE: request.created ─────►│
        │   (response held open)       │                               │
        │                              │                               │ claims R, types reply
        │                              │ ◄── POST /api/requests/R/respond
        │                              │ ── SSE: request.completed ───►│
        │ ◄── chunks / final JSON ─────┤                               │
```

Two SSE channels are involved:

- **Client → server response stream** (only when the API client passed
  `stream: true`): the server holds the HTTP response open and emits
  OpenAI-style `data: {chunk}\n\n` frames as the human types or once
  the human submits, terminated by `data: [DONE]`.
- **Server → browser event stream** (`GET /api/events`): the browser
  subscribes once on load and receives `request.created`,
  `request.claimed`, `request.completed`, and `request.cancelled`
  events. This is how the UI updates live without polling.

## Request lifecycle

A request moves through these states:

```
  pending ──► claimed ──► completed
     │           │
     └───────────┴──► cancelled
```

- **pending** — created by an inbound OpenAI call, waiting for a human.
- **claimed** — a browser session has taken responsibility for it. Other
  browsers should not also answer it. Claim is held by `sessionId`; if
  the session disconnects, the claim is released back to `pending`.
- **completed** — the human submitted a response; the server has
  delivered it to the API client and closed the inbound HTTP call.
- **cancelled** — the API client disconnected before a human responded,
  or a human explicitly declined the request.

The server is the single source of truth for state. Browsers read state
via `/api/requests` on load and stay in sync via the SSE event stream.

## Streaming responses to the API client

Two cases:

- `stream: false` (default) — the server waits for the human's full
  response, then returns one JSON body matching OpenAI's
  `chat.completion` shape.
- `stream: true` — the server flushes SSE frames as soon as it has
  content. v1 emits a single content chunk on submit plus the
  terminating `[DONE]` frame; v2 will emit token-by-token chunks as the
  human types, by piping `POST /api/requests/:id/stream` deltas
  through.

The chunk shape matches OpenAI's `chat.completion.chunk`:

```
{
  id, object: "chat.completion.chunk", created, model,
  choices: [{ index: 0, delta: { content: "..." }, finish_reason: null }]
}
```

## Components at a glance

| Component | Responsibility |
| --- | --- |
| `packages/server` | OpenAI-compatible endpoints, internal API, queue, SSE channels |
| `packages/web` | React UI: list pending requests, claim one, type and submit a response |
| `packages/shared` | Types: OpenAI request/response, internal `Request`, SSE event union |

Detailed designs live in [`components/server.md`](components/server.md)
and [`components/web.md`](components/web.md). The wire formats are in
[`api-contract.md`](api-contract.md).

## Non-goals (v1)

- Persistence across restarts. The queue lives in memory; restarting
  the server drops in-flight requests. (Future: SQLite.)
- Multi-tenant authentication. v1 trusts the network; deploy behind a
  reverse proxy or VPN if exposed.
- Real LLM fallback. If no human is connected, the request blocks
  until one is (or the API client times out).
- Function-calling, vision, or audio modalities. Text only.
