import { describe, expect, it } from "vitest";
import type { QueueEvent } from "@human-llm/shared";
import { CancelledError, Queue, QueueError } from "../src/queue/queue.js";

const baseInput = () => ({
  id: "chatcmpl-1",
  model: "human",
  messages: [{ role: "user" as const, content: "hi" }],
  stream: false,
  metadata: {},
});

function expectQueueError(fn: () => unknown, code: string): QueueError {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(QueueError);
    const qe = err as QueueError;
    expect(qe.code).toBe(code);
    return qe;
  }
  throw new Error(`expected QueueError(${code}) but no error was thrown`);
}

describe("Queue.create", () => {
  it("inserts a pending request and emits request.created", () => {
    const q = new Queue();
    const events: QueueEvent[] = [];
    q.on((e) => events.push(e));
    const r = q.create(baseInput());
    expect(r.state).toBe("pending");
    expect(r.id).toBe("chatcmpl-1");
    expect(r.claimedBy).toBeUndefined();
    expect(q.list()).toHaveLength(1);
    expect(q.get("chatcmpl-1")).toBe(r);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "request.created",
      request: { id: "chatcmpl-1", state: "pending" },
    });
  });

  it("throws when called twice with the same id", () => {
    const q = new Queue();
    q.create(baseInput());
    expect(() => q.create(baseInput())).toThrow(QueueError);
  });
});

describe("Queue.claim", () => {
  it("transitions pending to claimed and emits request.claimed", () => {
    const q = new Queue();
    q.create(baseInput());
    const events: QueueEvent[] = [];
    q.on((e) => events.push(e));
    const r = q.claim("chatcmpl-1", "session-a");
    expect(r.state).toBe("claimed");
    expect(r.claimedBy).toBe("session-a");
    expect(events).toEqual([
      { type: "request.claimed", id: "chatcmpl-1", claimedBy: "session-a" },
    ]);
  });

  it("on missing id throws not_found", () => {
    const q = new Queue();
    expectQueueError(() => q.claim("nope", "s"), "not_found");
  });

  it("on already-claimed by another session throws already_claimed", () => {
    const q = new Queue();
    q.create(baseInput());
    q.claim("chatcmpl-1", "s1");
    expectQueueError(() => q.claim("chatcmpl-1", "s2"), "already_claimed");
  });

  it("by the same session is idempotent (no second event)", () => {
    const q = new Queue();
    q.create(baseInput());
    q.claim("chatcmpl-1", "s1");
    const events: QueueEvent[] = [];
    q.on((e) => events.push(e));
    const r = q.claim("chatcmpl-1", "s1");
    expect(r.state).toBe("claimed");
    expect(events).toHaveLength(0);
  });

  it("on completed throws terminal", () => {
    const q = new Queue();
    q.create(baseInput());
    q.claim("chatcmpl-1", "s");
    q.complete("chatcmpl-1", "s", "ok");
    expectQueueError(() => q.claim("chatcmpl-1", "s"), "terminal");
  });

  it("on cancelled throws terminal", () => {
    const q = new Queue();
    q.create(baseInput());
    q.cancel("chatcmpl-1", undefined, "client_disconnected");
    expectQueueError(() => q.claim("chatcmpl-1", "s"), "terminal");
  });
});

describe("Queue.release", () => {
  it("transitions claimed back to pending", () => {
    const q = new Queue();
    q.create(baseInput());
    q.claim("chatcmpl-1", "s");
    const r = q.release("chatcmpl-1");
    expect(r.state).toBe("pending");
    expect(r.claimedBy).toBeUndefined();
  });

  it("on pending throws not_claimed", () => {
    const q = new Queue();
    q.create(baseInput());
    expectQueueError(() => q.release("chatcmpl-1"), "not_claimed");
  });

  it("on missing throws not_found", () => {
    const q = new Queue();
    expectQueueError(() => q.release("nope"), "not_found");
  });

  it("on completed throws not_claimed", () => {
    const q = new Queue();
    q.create(baseInput());
    q.claim("chatcmpl-1", "s");
    q.complete("chatcmpl-1", "s", "ok");
    expectQueueError(() => q.release("chatcmpl-1"), "not_claimed");
  });
});

describe("Queue.complete", () => {
  it("resolves wait() with content and emits request.completed", async () => {
    const q = new Queue();
    q.create(baseInput());
    q.claim("chatcmpl-1", "s");
    const events: QueueEvent[] = [];
    q.on((e) => events.push(e));
    const p = q.wait("chatcmpl-1");
    q.complete("chatcmpl-1", "s", "hello world");
    await expect(p).resolves.toBe("hello world");
    expect(events).toEqual([{ type: "request.completed", id: "chatcmpl-1" }]);
  });

  it("with wrong session throws wrong_session", () => {
    const q = new Queue();
    q.create(baseInput());
    q.claim("chatcmpl-1", "s1");
    expectQueueError(
      () => q.complete("chatcmpl-1", "s2", "x"),
      "wrong_session",
    );
  });

  it("on pending throws not_claimed", () => {
    const q = new Queue();
    q.create(baseInput());
    expectQueueError(() => q.complete("chatcmpl-1", "s", "x"), "not_claimed");
  });

  it("on missing throws not_found", () => {
    const q = new Queue();
    expectQueueError(() => q.complete("nope", "s", "x"), "not_found");
  });

  it("on completed throws terminal", () => {
    const q = new Queue();
    q.create(baseInput());
    q.claim("chatcmpl-1", "s");
    q.complete("chatcmpl-1", "s", "first");
    expectQueueError(() => q.complete("chatcmpl-1", "s", "second"), "terminal");
  });

  it("on cancelled throws terminal", () => {
    const q = new Queue();
    q.create(baseInput());
    q.claim("chatcmpl-1", "s");
    // Attach a noop handler so the rejection isn't unhandled.
    q.wait("chatcmpl-1").catch(() => {});
    q.cancel("chatcmpl-1", "s", "x");
    expectQueueError(() => q.complete("chatcmpl-1", "s", "x"), "terminal");
  });
});

describe("Queue.cancel", () => {
  it("pending → cancelled, rejects wait() with CancelledError", async () => {
    const q = new Queue();
    q.create(baseInput());
    const p = q.wait("chatcmpl-1");
    q.cancel("chatcmpl-1", undefined, "client_disconnected");
    await expect(p).rejects.toBeInstanceOf(CancelledError);
    await expect(p).rejects.toMatchObject({ reason: "client_disconnected" });
  });

  it("claimed → cancelled (no session check when sessionId undefined)", () => {
    const q = new Queue();
    q.create(baseInput());
    q.claim("chatcmpl-1", "s1");
    q.wait("chatcmpl-1").catch(() => {});
    const events: QueueEvent[] = [];
    q.on((e) => events.push(e));
    q.cancel("chatcmpl-1", undefined, "client_disconnected");
    expect(q.get("chatcmpl-1")?.state).toBe("cancelled");
    expect(events).toEqual([{ type: "request.cancelled", id: "chatcmpl-1" }]);
  });

  it("with wrong session throws wrong_session", () => {
    const q = new Queue();
    q.create(baseInput());
    q.claim("chatcmpl-1", "s1");
    q.wait("chatcmpl-1").catch(() => {});
    expectQueueError(() => q.cancel("chatcmpl-1", "s2", "x"), "wrong_session");
  });

  it("with matching session succeeds", () => {
    const q = new Queue();
    q.create(baseInput());
    q.claim("chatcmpl-1", "s1");
    q.wait("chatcmpl-1").catch(() => {});
    expect(q.cancel("chatcmpl-1", "s1", "human_declined")?.state).toBe(
      "cancelled",
    );
  });

  it("is idempotent on cancelled (no second event)", () => {
    const q = new Queue();
    q.create(baseInput());
    q.wait("chatcmpl-1").catch(() => {});
    q.cancel("chatcmpl-1", undefined, "x");
    const events: QueueEvent[] = [];
    q.on((e) => events.push(e));
    expect(() => q.cancel("chatcmpl-1", undefined, "x")).not.toThrow();
    expect(events).toHaveLength(0);
  });

  it("is idempotent on completed and does not reject the completion", async () => {
    const q = new Queue();
    q.create(baseInput());
    q.claim("chatcmpl-1", "s");
    const p = q.wait("chatcmpl-1");
    q.complete("chatcmpl-1", "s", "yay");
    q.cancel("chatcmpl-1", undefined, "later");
    await expect(p).resolves.toBe("yay");
  });

  it("on missing id is a no-op", () => {
    const q = new Queue();
    expect(q.cancel("nope", undefined, "x")).toBeUndefined();
  });
});

describe("Queue event ordering", () => {
  it("created → claimed → completed", () => {
    const q = new Queue();
    const events: QueueEvent[] = [];
    q.on((e) => events.push(e));
    q.create(baseInput());
    q.claim("chatcmpl-1", "s");
    q.complete("chatcmpl-1", "s", "ok");
    expect(events.map((e) => e.type)).toEqual([
      "request.created",
      "request.claimed",
      "request.completed",
    ]);
  });

  it("created → cancelled (no claim)", () => {
    const q = new Queue();
    const events: QueueEvent[] = [];
    q.on((e) => events.push(e));
    q.create(baseInput());
    q.wait("chatcmpl-1").catch(() => {});
    q.cancel("chatcmpl-1", undefined, "client_disconnected");
    expect(events.map((e) => e.type)).toEqual([
      "request.created",
      "request.cancelled",
    ]);
  });

  it("on() unsubscribe stops events", () => {
    const q = new Queue();
    const events: QueueEvent[] = [];
    const off = q.on((e) => events.push(e));
    q.create(baseInput());
    off();
    q.claim("chatcmpl-1", "s");
    expect(events.map((e) => e.type)).toEqual(["request.created"]);
  });
});
