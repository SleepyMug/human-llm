import { useCallback, useEffect, useMemo } from "react";
import type { JSX } from "react";
import type { PendingRequest } from "@human-llm/shared";
import { Toolbar } from "./components/Toolbar.js";
import { RequestList } from "./components/RequestList.js";
import { RequestView } from "./components/RequestView.js";
import { type Store, useStore } from "./state/store.js";
import { subscribeToEvents } from "./api/events.js";
import {
  cancelRequest,
  claimRequest,
  fetchRequests,
  respondToRequest,
} from "./api/client.js";

interface AppProps {
  store: Store;
}

function sortRequests(map: Record<string, PendingRequest>): PendingRequest[] {
  return Object.values(map).sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  );
}

export function App({ store }: AppProps): JSX.Element {
  const sessionId = useStore(store, (s) => s.sessionId);
  const connection = useStore(store, (s) => s.connection);
  const banner = useStore(store, (s) => s.banner);
  const requestsMap = useStore(store, (s) => s.requests);
  const claimedId = useStore(store, (s) => s.claimedId);

  const requests = useMemo(() => sortRequests(requestsMap), [requestsMap]);
  const selectedId = claimedId;
  const selected = selectedId ? requestsMap[selectedId] ?? null : null;
  const isClaimedByMe =
    selected !== null &&
    selected.state === "claimed" &&
    selected.claimedBy === sessionId;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const list = await fetchRequests();
        if (cancelled) return;
        store.dispatch({ type: "hydrate", requests: list });
      } catch {
        // Ignored — SSE events will populate state.
      }
    })();
    const sub = subscribeToEvents(store, sessionId);
    return () => {
      cancelled = true;
      sub.close();
    };
  }, [store, sessionId]);

  const handleClaim = useCallback(
    async (id: string) => {
      store.dispatch({ type: "claim/optimistic", id });
      try {
        await claimRequest(id, sessionId);
      } catch (err) {
        store.dispatch({ type: "claim/failed", id });
        throw err;
      }
    },
    [store, sessionId],
  );

  const handleSubmit = useCallback(
    async (id: string, content: string) => {
      await respondToRequest(id, sessionId, content);
      // The SSE `request.completed` event drops it from the store; clear our
      // local pointer immediately so the UI updates without a round trip.
      store.dispatch({ type: "release/local" });
    },
    [store, sessionId],
  );

  const handleDecline = useCallback(
    async (id: string) => {
      await cancelRequest(id, sessionId);
      store.dispatch({ type: "release/local" });
    },
    [store, sessionId],
  );

  const handleSelect = useCallback(
    (id: string) => {
      const target = store.getState().requests[id];
      if (!target) return;
      if (target.state === "claimed" && target.claimedBy === sessionId) {
        store.dispatch({ type: "claim/optimistic", id });
        return;
      }
      if (target.state === "pending") {
        void handleClaim(id);
      }
    },
    [store, sessionId, handleClaim],
  );

  const handleDismissBanner = useCallback(() => {
    store.dispatch({ type: "banner/clear" });
  }, [store]);

  return (
    <div className="app">
      <Toolbar
        sessionId={sessionId}
        connection={connection}
        banner={banner}
        onDismissBanner={handleDismissBanner}
      />
      <main className="app__main">
        <RequestList
          requests={requests}
          selectedId={selectedId}
          sessionId={sessionId}
          onSelect={handleSelect}
        />
        <RequestView
          request={selected}
          sessionId={sessionId}
          isClaimedByMe={isClaimedByMe}
          onClaim={handleClaim}
          onSubmit={handleSubmit}
          onDecline={handleDecline}
        />
      </main>
    </div>
  );
}
