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
  index.ts           # boot + Fastify wiring
  config.ts          # port, host, log level (env-driven)
  routes/
    openai.ts        # /v1/chat/completions, /v1/models
    api.ts           # /api/* internal endpoints
    events.ts        # /api/events SSE handler
  queue/
    queue.ts         # the in-memory queue + state transitions
    types.ts         # Request, RequestState (re-exports from shared)
  pending/
    pending.ts       # map of held inbound responses keyed by request id
  events/
    bus.ts           # in-process event bus (EventEmitter wrapper)
  util/
    sse.ts           # tiny SSE writer helpers
    ids.ts           # `chatcmpl-<random>` id generator
```

## Queue invariants

The queue is the source of truth. Its operations are synchronous and
single-threaded (Node single-threaded JS), so we don't need locks.

- `create(req)` — adds a `pending` request, emits `request.created`.
- `claim(id, sessionId)` — `pending → claimed` for that session, or
  throws if not pending. Emits `request.claimed`.
- `release(id)` — `claimed → pending`, e.g. on session disconnect.
- `complete(id, sessionId, content)` — `claimed → completed` if the
  session matches. Emits `request.completed` and resolves the pending
  inbound response.
- `cancel(id, sessionId?, reason)` — `* → cancelled`. Emits
  `request.cancelled` and rejects the pending inbound response.

State transitions that aren't allowed throw; HTTP handlers translate
those into 409 / 404 responses.

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

For `stream: false`, the handler awaits a promise that resolves when
the request completes, then returns the JSON body.

If the inbound socket closes before completion, the handler calls
`queue.cancel(id, undefined, "client_disconnected")` so any browser
that has it claimed sees a `request.cancelled` event and clears it.

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
  forbidden ones.
- Integration: `fastify.inject()` for routes, including streaming
  (assert SSE frames in order, terminating `[DONE]`).
- e2e: see [`../testing.md`](../testing.md).
