# human-llm

An OpenAI-compatible HTTP API where a human in a browser writes the
response. Point any OpenAI client at it and a person on the other end
types the assistant's reply.

Useful for:

- Wizard-of-Oz testing of LLM-powered apps without burning tokens or
  waiting on a real model.
- Capturing human "ideal" responses for eval / fine-tune datasets.
- Demos and teaching where a human pretends to be the model.
- Debugging downstream agent behavior by hand-crafting model output.

## Requirements

- Node ≥ 20, npm ≥ 9.

## Quickstart

```bash
git clone <this-repo>
cd human-llm
npm install
```

You need two terminals: one for the Fastify server, one for the Vite
dev server that hosts the human-facing UI.

**Terminal 1 — server (port 8080):**

```bash
npm run dev -w @human-llm/server
```

**Terminal 2 — web UI (port 5173):**

```bash
npm run dev -w @human-llm/web
```

Open <http://localhost:5173> in a browser. The toolbar should show
**Connected**.

### Send a request

In a third terminal, hit the OpenAI-compatible endpoint:

```bash
curl http://localhost:8080/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "human",
    "messages": [{"role": "user", "content": "What is the capital of France?"}]
  }'
```

The call hangs. In the browser, the request appears in the left-hand
list. Click it, type a reply on the right, hit `Cmd/Ctrl+Enter` to
submit. The curl call returns an OpenAI `chat.completion` body
carrying your reply.

### Streaming

Add `"stream": true` to receive `chat.completion.chunk` SSE frames
ending with `data: [DONE]`:

```bash
curl -N http://localhost:8080/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "human",
    "stream": true,
    "messages": [{"role": "user", "content": "Hi"}]
  }'
```

### Using the OpenAI SDK

Point the SDK at the server with any non-empty key:

```ts
import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "http://localhost:8080/v1",
  apiKey: "unused",
});

const res = await client.chat.completions.create({
  model: "human",
  messages: [{ role: "user", content: "Hello?" }],
});
console.log(res.choices[0].message.content);
```

## How it works

```
   OpenAI client                Server                  Human (browser)
        │                          │                          │
        │ POST /v1/chat/completions│                          │
        ├─────────────────────────►│ enqueue request          │
        │                          │ ── SSE: created ────────►│
        │  (response held open)    │                          │ types reply
        │                          │ ◄── POST /respond ───────│
        │ ◄── chunks / final JSON ─│                          │
```

The Fastify server holds the inbound HTTP response open while the
queued request waits for a human. The browser subscribes to a
server-sent event stream (`/api/events`) to stay in sync with the
queue. See [`docs/architecture.md`](docs/architecture.md) for the full
picture, including the request lifecycle and streaming protocol, and
[`docs/api-contract.md`](docs/api-contract.md) for the wire formats.

## Project layout

```
human-llm/
  package.json           # npm workspace root
  playwright.config.ts   # root-level Playwright config
  packages/
    shared/              # types shared between server and web
    server/              # Fastify backend
    web/                 # Vite + React frontend
  tests/
    e2e/                 # Playwright end-to-end tests
  docs/                  # design docs (start at docs/index.md)
```

## Configuration

The server reads its config from environment variables at boot:

| Var | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8080` | HTTP listen port |
| `HOST` | `0.0.0.0` | HTTP bind address |
| `LOG_LEVEL` | `info` | pino log level |

The web dev server picks up:

| Var | Default | Purpose |
| --- | --- | --- |
| `WEB_PORT` | `5173` | Vite dev server port |
| `HUMAN_LLM_SERVER_PORT` | `8080` | Backend port that `/api` and `/v1` proxy to |

## Development

```bash
npm run typecheck   # tsc --noEmit across all workspaces
npm test            # vitest in each workspace
npm run test:e2e    # Playwright (boots server + web automatically)
npm run build       # build the web bundle
```

First-time Playwright runs need browsers installed:

```bash
npx playwright install --with-deps chromium
```

## Status and non-goals

v1 is in-memory only — restarting the server drops in-flight requests
— and trusts the network (no auth). Function-calling, vision, and
audio are out of scope. See [`docs/architecture.md`](docs/architecture.md#non-goals-v1)
for the full list.
