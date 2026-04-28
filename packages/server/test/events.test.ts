import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { QueueEvent } from "@human-llm/shared";
import { buildApp, type BuiltApp } from "../src/app.js";

let counter = 0;
const fakeIds = () => `chatcmpl-test-${++counter}`;

let app: BuiltApp;
let baseUrl: string;

beforeEach(async () => {
  counter = 0;
  app = buildApp({ generateId: fakeIds });
  await app.server.listen({ host: "127.0.0.1", port: 0 });
  const addr = app.server.server.address();
  if (!addr || typeof addr === "string") throw new Error("no address");
  baseUrl = `http://127.0.0.1:${addr.port}`;
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

interface EventSubscriber {
  events: QueueEvent[];
  abort: () => Promise<void>;
  waitFor: (predicate: (events: QueueEvent[]) => boolean, ms?: number) => Promise<void>;
  response: Response;
}

async function openEventStream(sessionId?: string): Promise<EventSubscriber> {
  const ac = new AbortController();
  const qs = sessionId === undefined
    ? ""
    : `?sessionId=${encodeURIComponent(sessionId)}`;
  const response = await fetch(`${baseUrl}/api/events${qs}`, {
    signal: ac.signal,
  });

  const events: QueueEvent[] = [];
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const readLoop = (async () => {
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buffer.indexOf("\n\n")) >= 0) {
          const frame = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          if (frame.startsWith("data: ")) {
            events.push(JSON.parse(frame.slice("data: ".length)) as QueueEvent);
          }
        }
      }
    } catch {
      // Aborts surface as errors; that's fine.
    }
  })();

  return {
    events,
    response,
    abort: async () => {
      ac.abort();
      await readLoop;
    },
    waitFor: async (predicate, ms = 1000) => {
      const start = Date.now();
      while (!predicate(events)) {
        if (Date.now() - start > ms) throw new Error("event waitFor timeout");
        await new Promise((r) => setTimeout(r, 5));
      }
    },
  };
}

const samplePayload = {
  model: "gpt-4",
  messages: [{ role: "user", content: "hi" }],
};

describe("GET /api/events", () => {
  it("sets SSE headers", async () => {
    const sub = await openEventStream("s1");
    expect(sub.response.status).toBe(200);
    expect(sub.response.headers.get("content-type")).toContain(
      "text/event-stream",
    );
    expect(sub.response.headers.get("cache-control")).toBe("no-cache");
    expect(sub.response.headers.get("connection")).toBe("keep-alive");
    await sub.abort();
  });

  it("emits request.created → request.claimed → request.completed in order", async () => {
    const sub = await openEventStream("s1");

    const completionPromise = fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(samplePayload),
    });

    await sub.waitFor((evs) =>
      evs.some((e) => e.type === "request.created"),
    );
    const created = sub.events.find((e) => e.type === "request.created")!;
    if (created.type !== "request.created") throw new Error("type guard");
    const id = created.request.id;
    expect(created.request.state).toBe("pending");

    const claimRes = await fetch(`${baseUrl}/api/requests/${id}/claim`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: "s1" }),
    });
    expect(claimRes.status).toBe(200);
    await sub.waitFor((evs) =>
      evs.some((e) => e.type === "request.claimed"),
    );
    const claimed = sub.events.find((e) => e.type === "request.claimed")!;
    if (claimed.type !== "request.claimed") throw new Error("type guard");
    expect(claimed.id).toBe(id);
    expect(claimed.claimedBy).toBe("s1");

    const respondRes = await fetch(`${baseUrl}/api/requests/${id}/respond`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: "s1", content: "hello" }),
    });
    expect(respondRes.status).toBe(200);
    await sub.waitFor((evs) =>
      evs.some((e) => e.type === "request.completed"),
    );

    const completion = await completionPromise;
    expect(completion.status).toBe(200);
    const body = (await completion.json()) as {
      choices: Array<{ message: { content: string } }>;
    };
    expect(body.choices[0]!.message.content).toBe("hello");

    expect(sub.events.map((e) => e.type)).toEqual([
      "request.created",
      "request.claimed",
      "request.completed",
    ]);

    await sub.abort();
  });

  it("emits request.cancelled when the human cancels a claimed request", async () => {
    const sub = await openEventStream("s1");

    const completionPromise = fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(samplePayload),
    });

    await sub.waitFor((evs) => evs.some((e) => e.type === "request.created"));
    const created = sub.events.find((e) => e.type === "request.created")!;
    if (created.type !== "request.created") throw new Error("type guard");
    const id = created.request.id;

    await fetch(`${baseUrl}/api/requests/${id}/claim`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: "s1" }),
    });
    await sub.waitFor((evs) => evs.some((e) => e.type === "request.claimed"));

    const cancelRes = await fetch(`${baseUrl}/api/requests/${id}/cancel`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: "s1" }),
    });
    expect(cancelRes.status).toBe(200);

    await sub.waitFor((evs) => evs.some((e) => e.type === "request.cancelled"));
    const cancelled = sub.events.find((e) => e.type === "request.cancelled")!;
    if (cancelled.type !== "request.cancelled") throw new Error("type guard");
    expect(cancelled.id).toBe(id);

    const completion = await completionPromise;
    expect(completion.status).toBe(499);
    const body = await completion.json();
    expect(body).toEqual({
      error: {
        message: expect.stringContaining("human_declined"),
        type: "server_error",
        code: "human_declined",
      },
    });

    await sub.abort();
  });

  it("releases claims held by a session when its SSE connection drops", async () => {
    const subA = await openEventStream("session-a");
    const subB = await openEventStream("session-b");

    const completionPromise = fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(samplePayload),
    });

    await subA.waitFor((evs) => evs.some((e) => e.type === "request.created"));
    const created = subA.events.find((e) => e.type === "request.created")!;
    if (created.type !== "request.created") throw new Error("type guard");
    const id = created.request.id;

    const claim = await fetch(`${baseUrl}/api/requests/${id}/claim`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: "session-a" }),
    });
    expect(claim.status).toBe(200);
    await subA.waitFor((evs) => evs.some((e) => e.type === "request.claimed"));
    expect(app.queue.get(id)?.state).toBe("claimed");

    await subA.abort();

    await waitFor(() => app.queue.get(id)?.state === "pending");
    expect(app.queue.get(id)?.claimedBy).toBeUndefined();

    const reclaim = await fetch(`${baseUrl}/api/requests/${id}/claim`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: "session-b" }),
    });
    expect(reclaim.status).toBe(200);

    const respond = await fetch(`${baseUrl}/api/requests/${id}/respond`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: "session-b", content: "rescued" }),
    });
    expect(respond.status).toBe(200);

    const completion = await completionPromise;
    expect(completion.status).toBe(200);
    const body = (await completion.json()) as {
      choices: Array<{ message: { content: string } }>;
    };
    expect(body.choices[0]!.message.content).toBe("rescued");

    await subB.abort();
  });

  it("does not release another session's claims on disconnect", async () => {
    const subA = await openEventStream("session-a");
    const subB = await openEventStream("session-b");

    const completionPromise = fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(samplePayload),
    });

    await subB.waitFor((evs) => evs.some((e) => e.type === "request.created"));
    const created = subB.events.find((e) => e.type === "request.created")!;
    if (created.type !== "request.created") throw new Error("type guard");
    const id = created.request.id;

    await fetch(`${baseUrl}/api/requests/${id}/claim`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: "session-b" }),
    });
    await subB.waitFor((evs) => evs.some((e) => e.type === "request.claimed"));

    await subA.abort();
    await new Promise((r) => setTimeout(r, 50));
    expect(app.queue.get(id)?.state).toBe("claimed");
    expect(app.queue.get(id)?.claimedBy).toBe("session-b");

    await fetch(`${baseUrl}/api/requests/${id}/respond`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: "session-b", content: "ok" }),
    });
    await completionPromise.then((r) => r.text());
    await subB.abort();
  });
});

describe("POST /api/requests/:id/cancel", () => {
  it("returns 404 for missing requests", async () => {
    const res = await fetch(`${baseUrl}/api/requests/does-not-exist/cancel`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: "s1" }),
    });
    expect(res.status).toBe(404);
  });

  it("returns 409 when the request is pending (not claimed)", async () => {
    const completionPromise = fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(samplePayload),
    });
    await waitFor(() => app.queue.list().length === 1);
    const id = app.queue.list()[0]!.id;

    const res = await fetch(`${baseUrl}/api/requests/${id}/cancel`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: "s1" }),
    });
    expect(res.status).toBe(409);

    // Drain.
    await fetch(`${baseUrl}/api/requests/${id}/claim`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: "s1" }),
    });
    await fetch(`${baseUrl}/api/requests/${id}/respond`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: "s1", content: "ok" }),
    });
    await completionPromise.then((r) => r.text());
  });

  it("returns 409 when the session does not hold the claim", async () => {
    const completionPromise = fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(samplePayload),
    });
    await waitFor(() => app.queue.list().length === 1);
    const id = app.queue.list()[0]!.id;

    await fetch(`${baseUrl}/api/requests/${id}/claim`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: "s1" }),
    });

    const res = await fetch(`${baseUrl}/api/requests/${id}/cancel`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: "s2" }),
    });
    expect(res.status).toBe(409);

    // Drain.
    await fetch(`${baseUrl}/api/requests/${id}/respond`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: "s1", content: "ok" }),
    });
    await completionPromise.then((r) => r.text());
  });

  it("delivers an OpenAI-shaped human_declined error to the API client", async () => {
    const completionPromise = fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(samplePayload),
    });
    await waitFor(() => app.queue.list().length === 1);
    const id = app.queue.list()[0]!.id;

    await fetch(`${baseUrl}/api/requests/${id}/claim`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: "s1" }),
    });
    const cancelRes = await fetch(`${baseUrl}/api/requests/${id}/cancel`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: "s1" }),
    });
    expect(cancelRes.status).toBe(200);

    const completion = await completionPromise;
    expect(completion.status).toBe(499);
    expect(await completion.json()).toEqual({
      error: {
        message: expect.stringContaining("human_declined"),
        type: "server_error",
        code: "human_declined",
      },
    });
  });
});
