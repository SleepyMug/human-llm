# human-llm — design docs

`human-llm` is a service that exposes an OpenAI-compatible HTTP API but
routes each request to a human in a browser instead of forwarding it to
an LLM. The human types the response; the service streams it back to
the original API caller in OpenAI's chunk format.

Use cases:

- Wizard-of-Oz testing of LLM-powered apps without burning tokens or
  waiting on a real model.
- Capturing human "ideal" responses for eval / fine-tune datasets.
- Demos and teaching where a human pretends to be the model.
- Debugging downstream agent behavior by hand-crafting model output.

## How to read these docs

Start with `architecture.md` for the end-to-end picture, then drill in
as needed:

- [Architecture](architecture.md) — system overview, request lifecycle,
  components, and the streaming protocol.
- [API contract](api-contract.md) — the OpenAI-compatible surface plus
  the internal API that the browser UI talks to.
- Components:
  - [Server](components/server.md) — Fastify backend, queue, SSE.
  - [Web UI](components/web.md) — React frontend humans interact with.
- [Testing](testing.md) — Vitest for unit tests, Playwright for e2e.
- Decisions:
  - [0001 — TypeScript + Fastify + React](decisions/0001-stack.md)

## Repository layout

```
human-llm/
  package.json              # npm workspace root
  tsconfig.base.json        # shared TS config
  playwright.config.ts      # root-level Playwright config
  packages/
    shared/                 # types shared between server and web
    server/                 # Fastify backend
    web/                    # Vite + React frontend
  tests/
    e2e/                    # Playwright end-to-end tests
  docs/                     # this directory
```

## Status

The npm-workspace project skeleton, Fastify backend (queue, OpenAI
streaming, internal API + SSE), Vite + React frontend, and the full
Playwright e2e suite (happy path, streaming, cancellation,
multi-session) are all in place.

Feature implementation is split across follow-up issues:

- #3 — Backend MVP: Fastify + queue + non-streaming chat completions
- #4 — Backend: streaming chat completions
- #5 — Backend: internal API + SSE event channel
- #6 — Frontend MVP: Vite + React UI
- #7 — End-to-end Playwright suite for the full user flow
- #8 — CI: typecheck, vitest, and Playwright on every PR

Each subtask is scoped to be a single mergeable change. Dependencies
between them are noted in their issue bodies.
