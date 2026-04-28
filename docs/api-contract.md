# API contract

There are two HTTP surfaces:

- The **OpenAI-compatible** surface, consumed by external clients
  (OpenAI SDKs, LangChain, raw HTTP, etc.).
- The **internal** surface, consumed by the browser UI.

Both are served from the same Fastify process. Wire types are defined
in `packages/shared` and imported by both server and web.

## OpenAI-compatible surface

### `POST /v1/chat/completions`

Mirrors the subset of the OpenAI Chat Completions API that we honor.

Request body (all OpenAI fields are accepted; only the listed ones
affect behavior):

| Field | Effect |
| --- | --- |
| `model` | Echoed back in the response. Any string is accepted. |
| `messages` | Shown to the human verbatim. Required. |
| `stream` | If `true`, response is SSE chunks. Otherwise single JSON. |

Other fields (`temperature`, `top_p`, `max_tokens`, `tools`, …) are
accepted to keep clients happy but are otherwise stored as metadata
and shown to the human. They do not constrain the response.

Non-streaming response:

```json
{
  "id": "chatcmpl-...",
  "object": "chat.completion",
  "created": 1730000000,
  "model": "<echoed>",
  "choices": [{
    "index": 0,
    "message": { "role": "assistant", "content": "<human reply>" },
    "finish_reason": "stop"
  }],
  "usage": { "prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0 }
}
```

Streaming response: `Content-Type: text/event-stream`, frames:

```
data: {"id":"chatcmpl-...","object":"chat.completion.chunk","created":...,"model":"...","choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}

data: {"id":"chatcmpl-...","object":"chat.completion.chunk","created":...,"model":"...","choices":[{"index":0,"delta":{"content":"hello"},"finish_reason":null}]}

data: {"id":"chatcmpl-...","object":"chat.completion.chunk","created":...,"model":"...","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}

data: [DONE]

```

### `GET /v1/models`

Returns a single placeholder model so SDKs that pre-flight `models`
don't fail:

```json
{
  "object": "list",
  "data": [
    { "id": "human", "object": "model", "created": 0, "owned_by": "human-llm" }
  ]
}
```

### Errors

Match OpenAI's error envelope so SDKs surface them sensibly:

```json
{ "error": { "message": "...", "type": "invalid_request_error", "code": "..." } }
```

## Internal surface

All under `/api`. JSON unless noted. Not stable across releases.

### `GET /api/requests`

List pending and claimed requests. Used on page load to populate the
UI before SSE events take over.

Response: `{ "requests": Request[] }` where each `Request` is:

```ts
{
  id: string;
  state: "pending" | "claimed" | "completed" | "cancelled";
  claimedBy?: string;       // sessionId of claimer
  createdAt: string;        // ISO timestamp
  model: string;
  messages: ChatMessage[];
  stream: boolean;
  metadata: Record<string, unknown>; // other OpenAI fields verbatim
}
```

### `GET /api/events`

Server-Sent Events stream. The browser subscribes once on load. Frame
format: `data: <json>\n\n` where the JSON is one of:

```ts
type Event =
  | { type: "request.created"; request: Request }
  | { type: "request.claimed"; id: string; claimedBy: string }
  | { type: "request.completed"; id: string }
  | { type: "request.cancelled"; id: string };
```

Each browser identifies itself via a `sessionId` query param so the
server knows whose claims to release on disconnect.

### `POST /api/requests/:id/claim`

Body: `{ sessionId: string }`. Atomically transitions `pending →
claimed` for `sessionId`. Returns 409 if already claimed by someone
else, 404 if the request doesn't exist or has already completed.

### `POST /api/requests/:id/respond`

Body: `{ sessionId: string, content: string }`. The session must hold
the claim. Marks the request `completed` and delivers the content to
the waiting OpenAI client. Returns 200 on success.

### `POST /api/requests/:id/cancel`

Body: `{ sessionId: string }`. The session must hold the claim.
Cancels the request and returns an OpenAI-shaped error to the API
client (e.g. `type: "server_error"`, `code: "human_declined"`).

## Wire types live in `packages/shared`

Both server and web import from `@human-llm/shared` to stay in sync.
When you change a wire type, update it there once — TypeScript will
flag downstream callers in both packages.
