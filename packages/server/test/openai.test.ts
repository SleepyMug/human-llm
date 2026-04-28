import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp, type BuiltApp } from "../src/app.js";

let counter = 0;
const fakeIds = () => `chatcmpl-test-${++counter}`;

let app: BuiltApp;

beforeEach(() => {
  counter = 0;
  app = buildApp({ generateId: fakeIds });
});

afterEach(async () => {
  await app.server.close();
});

async function waitFor(check: () => boolean, ms = 1000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error("waitFor timeout");
    await new Promise((r) => setTimeout(r, 5));
  }
}

const samplePayload = {
  model: "gpt-4",
  messages: [{ role: "user", content: "hi" }],
};

describe("GET /v1/models", () => {
  it("returns the placeholder human model", async () => {
    const res = await app.server.inject({ method: "GET", url: "/v1/models" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      object: "list",
      data: [
        { id: "human", object: "model", created: 0, owned_by: "human-llm" },
      ],
    });
  });
});

describe("POST /v1/chat/completions (stream: false)", () => {
  it("non-streaming happy path returns OpenAI-shaped JSON", async () => {
    // Drive a fake human in parallel: claim once the request appears, then respond.
    const human = (async () => {
      await waitFor(() => app.queue.list().some((r) => r.state === "pending"));
      const id = app.queue.list().find((r) => r.state === "pending")!.id;
      const claimRes = await app.server.inject({
        method: "POST",
        url: `/api/requests/${id}/claim`,
        payload: { sessionId: "s1" },
      });
      expect(claimRes.statusCode).toBe(200);
      const respondRes = await app.server.inject({
        method: "POST",
        url: `/api/requests/${id}/respond`,
        payload: { sessionId: "s1", content: "hello back" },
      });
      expect(respondRes.statusCode).toBe(200);
    })();

    const res = await app.server.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: samplePayload,
    });
    await human;

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({
      id: "chatcmpl-test-1",
      object: "chat.completion",
      model: "gpt-4",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: "hello back" },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    });
    expect(typeof body.created).toBe("number");
  });

  it("captures non-control fields as metadata on the queued request", async () => {
    const pending = app.server.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: {
        ...samplePayload,
        temperature: 0.7,
        user: "alice",
      },
    });
    await waitFor(() => app.queue.list().length === 1);
    const id = app.queue.list()[0]!.id;
    expect(app.queue.get(id)?.metadata).toEqual({
      temperature: 0.7,
      user: "alice",
    });
    // Finish so the inject promise resolves cleanly.
    await app.server.inject({
      method: "POST",
      url: `/api/requests/${id}/claim`,
      payload: { sessionId: "s1" },
    });
    await app.server.inject({
      method: "POST",
      url: `/api/requests/${id}/respond`,
      payload: { sessionId: "s1", content: "ok" },
    });
    await pending;
  });

  it("rejects malformed bodies with 400", async () => {
    const res = await app.server.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: { messages: [] },
    });
    expect(res.statusCode).toBe(400);
  });

  it("cancels the request when the inbound socket closes", async () => {
    // light-my-request short-circuits abort once the body has been read,
    // so this case needs a real listener to simulate a mid-handler
    // disconnect.
    await app.server.listen({ host: "127.0.0.1", port: 0 });
    const addr = app.server.server.address();
    if (!addr || typeof addr === "string") throw new Error("no address");
    const url = `http://127.0.0.1:${addr.port}/v1/chat/completions`;

    const ac = new AbortController();
    const fetchPromise = fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(samplePayload),
      signal: ac.signal,
    }).catch((err: unknown) => err);

    await waitFor(() => app.queue.list().length === 1);
    const id = app.queue.list()[0]!.id;
    expect(app.queue.get(id)?.state).toBe("pending");

    ac.abort();

    await waitFor(() => app.queue.get(id)?.state === "cancelled");
    expect(app.queue.get(id)?.state).toBe("cancelled");
    await fetchPromise;
  });
});

describe("POST /api/requests/:id/claim", () => {
  it("returns 404 for missing requests", async () => {
    const res = await app.server.inject({
      method: "POST",
      url: "/api/requests/does-not-exist/claim",
      payload: { sessionId: "s1" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("returns 409 when already claimed by another session", async () => {
    const pending = app.server.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: samplePayload,
    });
    await waitFor(() => app.queue.list().length === 1);
    const id = app.queue.list()[0]!.id;
    const first = await app.server.inject({
      method: "POST",
      url: `/api/requests/${id}/claim`,
      payload: { sessionId: "s1" },
    });
    expect(first.statusCode).toBe(200);
    const second = await app.server.inject({
      method: "POST",
      url: `/api/requests/${id}/claim`,
      payload: { sessionId: "s2" },
    });
    expect(second.statusCode).toBe(409);
    // Drain the pending inbound call.
    await app.server.inject({
      method: "POST",
      url: `/api/requests/${id}/respond`,
      payload: { sessionId: "s1", content: "ok" },
    });
    await pending;
  });
});

describe("POST /api/requests/:id/respond", () => {
  it("returns 404 for missing requests", async () => {
    const res = await app.server.inject({
      method: "POST",
      url: "/api/requests/does-not-exist/respond",
      payload: { sessionId: "s1", content: "hi" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("returns 409 when the session does not hold the claim", async () => {
    const pending = app.server.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: samplePayload,
    });
    await waitFor(() => app.queue.list().length === 1);
    const id = app.queue.list()[0]!.id;
    await app.server.inject({
      method: "POST",
      url: `/api/requests/${id}/claim`,
      payload: { sessionId: "s1" },
    });
    const wrong = await app.server.inject({
      method: "POST",
      url: `/api/requests/${id}/respond`,
      payload: { sessionId: "s2", content: "x" },
    });
    expect(wrong.statusCode).toBe(409);
    // Drain the pending inbound call.
    await app.server.inject({
      method: "POST",
      url: `/api/requests/${id}/respond`,
      payload: { sessionId: "s1", content: "ok" },
    });
    await pending;
  });

  it("returns 409 when respond is called before claim", async () => {
    const pending = app.server.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: samplePayload,
    });
    await waitFor(() => app.queue.list().length === 1);
    const id = app.queue.list()[0]!.id;
    const res = await app.server.inject({
      method: "POST",
      url: `/api/requests/${id}/respond`,
      payload: { sessionId: "s1", content: "x" },
    });
    expect(res.statusCode).toBe(409);
    // Drain the pending inbound call.
    await app.server.inject({
      method: "POST",
      url: `/api/requests/${id}/claim`,
      payload: { sessionId: "s1" },
    });
    await app.server.inject({
      method: "POST",
      url: `/api/requests/${id}/respond`,
      payload: { sessionId: "s1", content: "ok" },
    });
    await pending;
  });
});

describe("GET /api/requests", () => {
  it("returns an empty list when nothing is queued", async () => {
    const res = await app.server.inject({ method: "GET", url: "/api/requests" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ requests: [] });
  });

  it("lists pending and claimed requests", async () => {
    const pending = app.server.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: samplePayload,
    });
    await waitFor(() => app.queue.list().length === 1);
    const id = app.queue.list()[0]!.id;
    const list1 = await app.server.inject({
      method: "GET",
      url: "/api/requests",
    });
    expect(list1.json().requests).toMatchObject([
      { id, state: "pending", model: "gpt-4" },
    ]);
    await app.server.inject({
      method: "POST",
      url: `/api/requests/${id}/claim`,
      payload: { sessionId: "s1" },
    });
    const list2 = await app.server.inject({
      method: "GET",
      url: "/api/requests",
    });
    expect(list2.json().requests[0]).toMatchObject({
      id,
      state: "claimed",
      claimedBy: "s1",
    });
    await app.server.inject({
      method: "POST",
      url: `/api/requests/${id}/respond`,
      payload: { sessionId: "s1", content: "ok" },
    });
    await pending;
  });
});

function parseSseFrames(body: string): string[] {
  return body
    .split("\n\n")
    .map((s) => s.replace(/^data: /, ""))
    .filter((s) => s.length > 0);
}

describe("POST /v1/chat/completions (stream: true)", () => {
  it("emits SSE chunks in order ending with [DONE]", async () => {
    const human = (async () => {
      await waitFor(() => app.queue.list().some((r) => r.state === "pending"));
      const id = app.queue.list().find((r) => r.state === "pending")!.id;
      const claimRes = await app.server.inject({
        method: "POST",
        url: `/api/requests/${id}/claim`,
        payload: { sessionId: "s1" },
      });
      expect(claimRes.statusCode).toBe(200);
      const respondRes = await app.server.inject({
        method: "POST",
        url: `/api/requests/${id}/respond`,
        payload: { sessionId: "s1", content: "hello back" },
      });
      expect(respondRes.statusCode).toBe(200);
    })();

    const res = await app.server.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: { ...samplePayload, stream: true },
    });
    await human;

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/event-stream");
    expect(res.headers["cache-control"]).toBe("no-cache");
    expect(res.headers["connection"]).toBe("keep-alive");

    const frames = parseSseFrames(res.body);
    expect(frames).toHaveLength(4);
    expect(frames[3]).toBe("[DONE]");

    const role = JSON.parse(frames[0]!);
    const content = JSON.parse(frames[1]!);
    const stop = JSON.parse(frames[2]!);

    expect(role).toMatchObject({
      id: "chatcmpl-test-1",
      object: "chat.completion.chunk",
      model: "gpt-4",
      choices: [
        { index: 0, delta: { role: "assistant" }, finish_reason: null },
      ],
    });
    expect(typeof role.created).toBe("number");
    expect(content.choices[0]).toEqual({
      index: 0,
      delta: { content: "hello back" },
      finish_reason: null,
    });
    expect(stop.choices[0]).toEqual({
      index: 0,
      delta: {},
      finish_reason: "stop",
    });
  });

  it("queues a streaming request with stream: true on the queue entry", async () => {
    const pending = app.server.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: { ...samplePayload, stream: true, temperature: 0.5 },
    });
    await waitFor(() => app.queue.list().length === 1);
    const entry = app.queue.list()[0]!;
    expect(entry.stream).toBe(true);
    expect(entry.metadata).toEqual({ temperature: 0.5 });
    await app.server.inject({
      method: "POST",
      url: `/api/requests/${entry.id}/claim`,
      payload: { sessionId: "s1" },
    });
    await app.server.inject({
      method: "POST",
      url: `/api/requests/${entry.id}/respond`,
      payload: { sessionId: "s1", content: "ok" },
    });
    await pending;
  });

  it("sends the initial role chunk before the human responds", async () => {
    await app.server.listen({ host: "127.0.0.1", port: 0 });
    const addr = app.server.server.address();
    if (!addr || typeof addr === "string") throw new Error("no address");
    const url = `http://127.0.0.1:${addr.port}/v1/chat/completions`;

    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...samplePayload, stream: true }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (!buffer.includes("\n\n")) {
      const { value, done } = await reader.read();
      if (done) throw new Error("stream ended before role chunk");
      buffer += decoder.decode(value, { stream: true });
    }

    const firstFrame = buffer.split("\n\n")[0]!.replace(/^data: /, "");
    const parsed = JSON.parse(firstFrame);
    expect(parsed.choices[0].delta).toEqual({ role: "assistant" });

    await waitFor(() => app.queue.list().length === 1);
    const id = app.queue.list()[0]!.id;
    await app.server.inject({
      method: "POST",
      url: `/api/requests/${id}/claim`,
      payload: { sessionId: "s1" },
    });
    await app.server.inject({
      method: "POST",
      url: `/api/requests/${id}/respond`,
      payload: { sessionId: "s1", content: "ok" },
    });

    let rest = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      rest += decoder.decode(value, { stream: true });
    }
    expect(rest).toContain("data: [DONE]");
  });

  it("cancels the request when the inbound socket closes mid-stream", async () => {
    await app.server.listen({ host: "127.0.0.1", port: 0 });
    const addr = app.server.server.address();
    if (!addr || typeof addr === "string") throw new Error("no address");
    const url = `http://127.0.0.1:${addr.port}/v1/chat/completions`;

    const ac = new AbortController();
    const fetchPromise = fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...samplePayload, stream: true }),
      signal: ac.signal,
    }).catch((err: unknown) => err);

    await waitFor(() => app.queue.list().length === 1);
    const id = app.queue.list()[0]!.id;
    expect(app.queue.get(id)?.state).toBe("pending");

    ac.abort();

    await waitFor(() => app.queue.get(id)?.state === "cancelled");
    expect(app.queue.get(id)?.state).toBe("cancelled");
    await fetchPromise;
  });
});
