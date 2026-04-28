import type { PendingRequest, QueueEvent } from "@human-llm/shared";

export type ConnectionState = "connecting" | "open" | "closed";

export interface WebState {
  sessionId: string;
  connection: ConnectionState;
  requests: Record<string, PendingRequest>;
  claimedId: string | null;
  /** Banner message shown when a claimed request is cancelled out from under us. */
  banner: string | null;
}

export type Action =
  | { type: "connection"; status: ConnectionState }
  | { type: "hydrate"; requests: PendingRequest[] }
  | { type: "event"; event: QueueEvent }
  | { type: "claim/optimistic"; id: string }
  | { type: "claim/failed"; id: string }
  | { type: "release/local" }
  | { type: "banner/clear" };

export function initialState(sessionId: string): WebState {
  return {
    sessionId,
    connection: "connecting",
    requests: {},
    claimedId: null,
    banner: null,
  };
}

function withRequest(
  state: WebState,
  id: string,
  patch: (r: PendingRequest) => PendingRequest,
): WebState {
  const existing = state.requests[id];
  if (!existing) return state;
  return { ...state, requests: { ...state.requests, [id]: patch(existing) } };
}

function dropRequest(state: WebState, id: string): WebState {
  if (!(id in state.requests)) {
    if (state.claimedId === id) return { ...state, claimedId: null };
    return state;
  }
  const next = { ...state.requests };
  delete next[id];
  return {
    ...state,
    requests: next,
    claimedId: state.claimedId === id ? null : state.claimedId,
  };
}

export function reducer(state: WebState, action: Action): WebState {
  switch (action.type) {
    case "connection":
      return { ...state, connection: action.status };

    case "hydrate": {
      const requests: Record<string, PendingRequest> = {};
      for (const r of action.requests) {
        if (r.state === "completed" || r.state === "cancelled") continue;
        requests[r.id] = r;
      }
      const claimedId = state.claimedId && requests[state.claimedId]
        ? state.claimedId
        : null;
      return { ...state, requests, claimedId };
    }

    case "event": {
      const e = action.event;
      switch (e.type) {
        case "request.created": {
          if (e.request.state === "completed" || e.request.state === "cancelled") {
            return state;
          }
          return {
            ...state,
            requests: { ...state.requests, [e.request.id]: e.request },
          };
        }
        case "request.claimed": {
          const next = withRequest(state, e.id, (r) => ({
            ...r,
            state: "claimed",
            claimedBy: e.claimedBy,
          }));
          // If we thought we claimed this but the server says someone else
          // got it, drop our local claim.
          if (
            next.claimedId === e.id &&
            e.claimedBy !== state.sessionId
          ) {
            return { ...next, claimedId: null };
          }
          return next;
        }
        case "request.completed": {
          return dropRequest(state, e.id);
        }
        case "request.cancelled": {
          const wasOurs = state.claimedId === e.id;
          const dropped = dropRequest(state, e.id);
          if (wasOurs) {
            return {
              ...dropped,
              banner: `Request ${e.id} was cancelled by the API client.`,
            };
          }
          return dropped;
        }
      }
      return state;
    }

    case "claim/optimistic":
      return { ...state, claimedId: action.id };

    case "claim/failed":
      return state.claimedId === action.id
        ? { ...state, claimedId: null }
        : state;

    case "release/local":
      return { ...state, claimedId: null };

    case "banner/clear":
      return { ...state, banner: null };
  }
}
