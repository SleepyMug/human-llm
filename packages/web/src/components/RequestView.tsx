import { useEffect, useState, type JSX, type KeyboardEvent } from "react";
import type { PendingRequest } from "@human-llm/shared";

interface RequestViewProps {
  request: PendingRequest | null;
  sessionId: string;
  isClaimedByMe: boolean;
  onClaim: (id: string) => void | Promise<void>;
  onSubmit: (id: string, content: string) => void | Promise<void>;
  onDecline: (id: string) => void | Promise<void>;
}

function metadataEntries(meta: Record<string, unknown>): Array<[string, string]> {
  return Object.entries(meta).map(([k, v]) => {
    const value = typeof v === "string" ? v : JSON.stringify(v);
    return [k, value];
  });
}

export function RequestView(props: RequestViewProps): JSX.Element {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = props.request?.id ?? null;

  useEffect(() => {
    setDraft("");
    setError(null);
  }, [requestId]);

  if (props.request === null) {
    return (
      <section className="request-view" data-testid="request-view-empty">
        <p>Select a pending request from the list to start replying.</p>
      </section>
    );
  }

  const r = props.request;
  const canSubmit =
    props.isClaimedByMe && draft.trim().length > 0 && !busy;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      await props.onSubmit(r.id, draft);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleClaim = async () => {
    setBusy(true);
    setError(null);
    try {
      await props.onClaim(r.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleDecline = async () => {
    setBusy(true);
    setError(null);
    try {
      await props.onDecline(r.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      void handleSubmit();
    }
  };

  const metaRows = metadataEntries(r.metadata);

  return (
    <section className="request-view" data-testid="request-view">
      <header className="request-view__header">
        <h2>
          <span className="request-view__model">{r.model}</span>
          <span className="request-view__id">{r.id}</span>
        </h2>
        <dl className="request-view__meta" data-testid="request-meta">
          <div>
            <dt>state</dt>
            <dd>{r.state}</dd>
          </div>
          <div>
            <dt>stream</dt>
            <dd>{r.stream ? "true" : "false"}</dd>
          </div>
          {metaRows.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      </header>

      <ol className="request-view__messages" data-testid="messages">
        {r.messages.map((m, i) => (
          <li key={i} className={`message message--${m.role}`}>
            <span className="message__role">{m.role}</span>
            <pre className="message__content">{m.content}</pre>
          </li>
        ))}
      </ol>

      {!props.isClaimedByMe && (
        <div className="request-view__claim">
          {r.state === "pending" ? (
            <button
              type="button"
              data-testid="claim-button"
              onClick={() => void handleClaim()}
              disabled={busy}
            >
              Claim
            </button>
          ) : (
            <p data-testid="claimed-by-other">
              Claimed by another session ({r.claimedBy ?? "unknown"}).
            </p>
          )}
        </div>
      )}

      {props.isClaimedByMe && (
        <div className="request-view__reply">
          <textarea
            data-testid="reply-input"
            aria-label="Reply"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type your reply. Cmd/Ctrl+Enter to submit."
            disabled={busy}
            rows={8}
          />
          <div className="request-view__actions">
            <button
              type="button"
              data-testid="submit-button"
              onClick={() => void handleSubmit()}
              disabled={!canSubmit}
            >
              Submit
            </button>
            <button
              type="button"
              data-testid="decline-button"
              onClick={() => void handleDecline()}
              disabled={busy}
            >
              Decline
            </button>
          </div>
        </div>
      )}

      {error !== null && (
        <p className="request-view__error" role="alert" data-testid="error">
          {error}
        </p>
      )}
    </section>
  );
}
