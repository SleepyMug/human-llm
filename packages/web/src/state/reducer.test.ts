import { describe, expect, it } from "vitest";
import type { PendingRequest, QueueEvent } from "@human-llm/shared";
import { initialState, reducer, type WebState } from "./reducer.js";

const SESSION = "sess-1";

function makeRequest(overrides: Partial<PendingRequest> = {}): PendingRequest {
  return {
    id: "req-1",
    state: "pending",
    createdAt: "2026-04-28T00:00:00.000Z",
    model: "human",
    messages: [{ role: "user", content: "hi" }],
    stream: false,
    metadata: {},
    ...overrides,
  };
}

function evt(e: QueueEvent): { type: "event"; event: QueueEvent } {
  return { type: "event", event: e };
}

describe("reducer", () => {
  it("starts disconnected and empty", () => {
    const s = initialState(SESSION);
    const expected: WebState = {
      sessionId: SESSION,
      connection: "connecting",
      requests: {},
      claimedId: null,
      banner: null,
    };
    expect(s).toEqual(expected);
  });

  it("hydrates only non-terminal requests", () => {
    const s = reducer(initialState(SESSION), {
      type: "hydrate",
      requests: [
        makeRequest({ id: "a", state: "pending" }),
        makeRequest({ id: "b", state: "completed" }),
        makeRequest({ id: "c", state: "claimed", claimedBy: SESSION }),
        makeRequest({ id: "d", state: "cancelled" }),
      ],
    });
    expect(Object.keys(s.requests).sort()).toEqual(["a", "c"]);
  });

  it("adds a request on request.created", () => {
    const r = makeRequest({ id: "x" });
    const s = reducer(initialState(SESSION), evt({ type: "request.created", request: r }));
    expect(s.requests.x).toEqual(r);
  });

  it("ignores terminal request.created events (defensive)", () => {
    const r = makeRequest({ id: "x", state: "completed" });
    const s = reducer(initialState(SESSION), evt({ type: "request.created", request: r }));
    expect(s.requests.x).toBeUndefined();
  });

  it("updates state and claimer on request.claimed", () => {
    let s = reducer(
      initialState(SESSION),
      evt({ type: "request.created", request: makeRequest({ id: "x" }) }),
    );
    s = reducer(s, evt({ type: "request.claimed", id: "x", claimedBy: "other" }));
    expect(s.requests.x?.state).toBe("claimed");
    expect(s.requests.x?.claimedBy).toBe("other");
  });

  it("clears local claim if another session won the race", () => {
    let s = reducer(
      initialState(SESSION),
      evt({ type: "request.created", request: makeRequest({ id: "x" }) }),
    );
    s = reducer(s, { type: "claim/optimistic", id: "x" });
    expect(s.claimedId).toBe("x");
    s = reducer(s, evt({ type: "request.claimed", id: "x", claimedBy: "other" }));
    expect(s.claimedId).toBeNull();
  });

  it("keeps local claim if our session won", () => {
    let s = reducer(
      initialState(SESSION),
      evt({ type: "request.created", request: makeRequest({ id: "x" }) }),
    );
    s = reducer(s, { type: "claim/optimistic", id: "x" });
    s = reducer(s, evt({ type: "request.claimed", id: "x", claimedBy: SESSION }));
    expect(s.claimedId).toBe("x");
  });

  it("drops request on request.completed", () => {
    let s = reducer(
      initialState(SESSION),
      evt({ type: "request.created", request: makeRequest({ id: "x" }) }),
    );
    s = reducer(s, { type: "claim/optimistic", id: "x" });
    s = reducer(s, evt({ type: "request.completed", id: "x" }));
    expect(s.requests.x).toBeUndefined();
    expect(s.claimedId).toBeNull();
  });

  it("drops request on request.cancelled and shows banner if it was ours", () => {
    let s = reducer(
      initialState(SESSION),
      evt({ type: "request.created", request: makeRequest({ id: "x" }) }),
    );
    s = reducer(s, { type: "claim/optimistic", id: "x" });
    s = reducer(s, evt({ type: "request.cancelled", id: "x" }));
    expect(s.requests.x).toBeUndefined();
    expect(s.claimedId).toBeNull();
    expect(s.banner).toMatch(/cancelled/i);
  });

  it("does not show a banner when an unclaimed request is cancelled", () => {
    let s = reducer(
      initialState(SESSION),
      evt({ type: "request.created", request: makeRequest({ id: "x" }) }),
    );
    s = reducer(s, evt({ type: "request.cancelled", id: "x" }));
    expect(s.banner).toBeNull();
  });

  it("clears banner via banner/clear", () => {
    let s: WebState = { ...initialState(SESSION), banner: "boom" };
    s = reducer(s, { type: "banner/clear" });
    expect(s.banner).toBeNull();
  });

  it("clears claim on claim/failed", () => {
    let s: WebState = { ...initialState(SESSION), claimedId: "x" };
    s = reducer(s, { type: "claim/failed", id: "x" });
    expect(s.claimedId).toBeNull();
  });

  it("tracks connection status", () => {
    let s = initialState(SESSION);
    s = reducer(s, { type: "connection", status: "open" });
    expect(s.connection).toBe("open");
    s = reducer(s, { type: "connection", status: "closed" });
    expect(s.connection).toBe("closed");
  });
});
