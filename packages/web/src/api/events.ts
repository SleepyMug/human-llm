import type { QueueEvent } from "@human-llm/shared";
import type { Store } from "../state/store.js";

export interface EventSubscription {
  close(): void;
}

/**
 * Open the SSE event stream and reduce events into the store.
 * Returns a subscription so the caller can close on unmount.
 */
export function subscribeToEvents(
  store: Store,
  sessionId: string,
  EventSourceCtor: typeof EventSource = EventSource,
): EventSubscription {
  const url = `/api/events?sessionId=${encodeURIComponent(sessionId)}`;
  const source = new EventSourceCtor(url);

  source.onopen = () => {
    store.dispatch({ type: "connection", status: "open" });
  };

  source.onerror = () => {
    // EventSource auto-reconnects; surface the gap as "connecting".
    if (source.readyState === source.CLOSED) {
      store.dispatch({ type: "connection", status: "closed" });
    } else {
      store.dispatch({ type: "connection", status: "connecting" });
    }
  };

  source.onmessage = (msg) => {
    let event: QueueEvent;
    try {
      event = JSON.parse(msg.data) as QueueEvent;
    } catch {
      return;
    }
    store.dispatch({ type: "event", event });
  };

  return {
    close() {
      source.close();
      store.dispatch({ type: "connection", status: "closed" });
    },
  };
}
