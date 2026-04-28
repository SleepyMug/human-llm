# Server (`packages/server`)

Fastify HTTP server in TypeScript. Holds the request queue in memory,
exposes the OpenAI-compatible API to external clients, and exposes the
internal API + SSE event channel to the web UI.

## Responsibilities

- Accept inbound `POST /v1/chat/completions` calls; create a `Request`,
  enqueue it, and hold the HTTP response open until a human submits.
- Serve `GET /api/requests` and `GET /api/events` for the web UI.
- Atomically move requests through `pending → claimed → completed`.
- When a request is completed or cancelled, deliver the result (or
  OpenAI-shaped error) on the held inbound response.
- Track sessions; release claims when a session disconnects.

## Internal modules

```
packages/server/src/
  index.ts           # boot entry point — loads config, builds app, listens
  app.ts             # buildApp(): Fastify wiring + route registration
  config.ts          # port, host, log level (env-driven)
  routes/
    openai.ts        # /v1/chat/completions, /v1/models
    api.ts           # /api/* internal endpoints
    events.ts        # /api/events SSE handler  (issue #5)
  queue/
    queue.ts         # in-memory queue + state transitions + per-request
                     #   completion promises (the "pending" map in the
                     #   original design is folded into the queue entry)
  util/
    sse.ts           # tiny SSE writer helpers
    ids.ts           # `chatcmpl-<random>` id generator
    errors.ts        # OpenAI-shaped error envelopes
```

## Queue invariants

The queue is the source of truth. Its operations are synchronous and
single-threaded (Node single-threaded JS), so we don't need locks.

- `create(input)` — adds a `pending` request and a `done` promise, emits
  `request.created`. Returns the created `PendingRequest`.
- `claim(id, sessionId)` — `pending → claimed` for that session.
  Re-claim by the same session is idempotent and emits no event. Emits
  `request.claimed`.
- `release(id)` — `claimed → pending`. (No event in the v1 wire spec.)
- `complete(id, sessionId, content)` — `claimed → completed` if the
  session matches. Emits `request.completed` and resolves `wait(id)`.
- `cancel(id, sessionId?, reason)` — `pending|claimed → cancelled`.
  Idempotent on terminal states (no-op, no event). Emits
  `request.cancelled` and rejects `wait(id)` with `CancelledError`.
- `wait(id)` — returns the per-request done-promise (the held inbound
  response is parked on this).
- `list()`, `get(id)`, `on(handler)` — read access and event
  subscription.

Errors thrown by forbidden transitions are `QueueError` with one of:
`not_found`, `already_claimed`, `terminal`, `not_claimed`,
`wrong_session`. HTTP handlers translate these into 404 / 409
responses (terminal and not_found → 404; the rest → 409).

## Handling streaming inbound calls

For `stream: true`, the handler:

1. Sets headers `Content-Type: text/event-stream`, `Cache-Control:
   no-cache`, `Connection: keep-alive`.
2. Sends an initial `role: "assistant"` delta chunk so SDKs know the
   stream has started.
3. Registers itself in `pending` keyed by request id.
4. When the queue emits `request.completed`, sends a content delta
   chunk plus a `finish_reason: "stop"` chunk plus `data: [DONE]`,
   then closes.

For `stream: false`, the handler awaits `queue.wait(id)`, which
resolves with the human's content on `complete` and rejects on
`cancel`. On resolve it returns the OpenAI-shaped JSON body.

If the inbound socket closes before completion, the handler calls
`queue.cancel(id, undefined, "client_disconnected")` so any browser
that has it claimed sees a `request.cancelled` event and clears it.

Disconnect is detected via a `close` listener on `reply.raw` (the
response stream), guarded by `reply.raw.writableEnded`. The request
stream's `close` event fires immediately after the body is read in
Node's HTTP plumbing and is not a reliable disconnect signal; the
response stream's `close` only fires after the response is sent or
the connection is destroyed.

## Configuration

Read once at boot from env:

| Var | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8080` | HTTP listen port |
| `HOST` | `0.0.0.0` | HTTP bind address |
| `LOG_LEVEL` | `info` | pino log level |

The web UI is served by Vite in dev and by static-file middleware in
prod. In dev, run server and Vite in parallel; Vite proxies `/api/*`
and `/v1/*` to the server.

## Tests

- Unit: queue state machine (vitest) — every transition + the
  forbidden ones; id generator and SSE helpers.
- Integration: `fastify.inject()` for routes — non-streaming happy
  path, claim conflicts, missing requests, metadata extraction, list
  endpoint. The client-disconnect test uses a real `app.listen()` +
  `fetch` with `AbortController`, because `light-my-request` short-
  circuits its abort signal once the request body is consumed and
  cannot simulate a mid-handler client close.
- Streaming integration tests assert SSE headers, frame order
  (`role` → `content` → `finish_reason: "stop"` → `[DONE]`), that the
  initial `role` chunk is flushed before the human responds (real
  listener + `fetch`), and that an aborted client connection cancels
  the queued request.
- e2e: see [`../testing.md`](../testing.md).
