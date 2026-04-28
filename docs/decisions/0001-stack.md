# 0001 — TypeScript + Fastify + React + Playwright

Date: 2026-04-28
Status: Accepted

## Context

The project needs a backend that holds long-lived HTTP responses open
(streaming SSE), an interactive web UI, and end-to-end tests that
exercise both. The issue body explicitly calls out Playwright for
frontend testing.

## Decision

- **Language: TypeScript everywhere.** Server, web, and shared types
  in one language means one toolchain (`tsc`, `vitest`, `eslint`) and
  the ability to share request/response types between server and
  browser via a `shared` workspace package.
- **Backend: Fastify.** First-class TypeScript types, JSON-schema
  request validation built in, low overhead for SSE via `reply.raw`,
  and ergonomic in-process testing via `fastify.inject()`.
- **Frontend: React + Vite.** Standard, well-documented, plays well
  with Playwright. Vite's dev-server proxy makes local development
  against a separate Fastify process trivial.
- **Real-time: Server-Sent Events.** Both directions in this app are
  one-way streams (server → API client for chunked completions; server
  → browser for queue events). SSE over HTTP is simpler than
  WebSockets, plays well with proxies, and matches the OpenAI
  streaming format we already need to emit.
- **Testing: Vitest + Playwright.**
  - Vitest for unit and integration tests inside each package.
  - Playwright at the repo root for full-stack e2e — explicitly
    requested, and the only way to honestly exercise an interactive
    browser flow.
- **Project layout: npm workspaces** with `packages/{shared,server,web}`
  and `tests/e2e/` at the root.

## Alternatives considered

- **Python (FastAPI) backend.** Rejected: would split the toolchain
  and prevent shared types between server and browser. FastAPI is
  excellent for OpenAI-shaped APIs, but the cost of bilingual repo +
  duplicated types isn't worth it here.
- **Express.** Rejected: weaker TypeScript support than Fastify, and
  no built-in schema validation. Fastify's testing story is also
  better.
- **WebSockets** for the browser channel. Rejected for v1: SSE is
  enough (we never push from browser to server over the same channel)
  and avoids an extra protocol upgrade path.
- **Single package, no workspaces.** Rejected: shared types between
  server and web is a strong driver, and workspaces keep that clean.
  The overhead of one extra `package.json` per package is small.

## Consequences

- All contributors need Node ≥ 20 and npm ≥ 10 (workspaces).
- Playwright's chromium download adds ~200MB to first-run install;
  cached in CI and persisted in the dev container's Dockerfile.
- Streaming code paths must be tested with real chunk-by-chunk
  assertions — easy to write a test that passes against a buffered
  response but breaks against a real client.
