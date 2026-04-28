import type { JSX } from "react";
import type { PendingRequest } from "@human-llm/shared";

interface RequestListProps {
  requests: PendingRequest[];
  selectedId: string | null;
  sessionId: string;
  onSelect: (id: string) => void;
}

function describe(request: PendingRequest): string {
  const last = request.messages[request.messages.length - 1];
  if (!last) return "(empty)";
  const text = last.content.replace(/\s+/g, " ").trim();
  return text.length > 80 ? `${text.slice(0, 77)}…` : text;
}

export function RequestList(props: RequestListProps): JSX.Element {
  if (props.requests.length === 0) {
    return (
      <aside className="request-list" data-testid="request-list">
        <p className="request-list__empty" data-testid="status">
          No requests pending.
        </p>
      </aside>
    );
  }
  return (
    <aside className="request-list" data-testid="request-list">
      <ul>
        {props.requests.map((r) => {
          const isSelected = r.id === props.selectedId;
          const claimedByOther =
            r.state === "claimed" && r.claimedBy !== props.sessionId;
          return (
            <li key={r.id}>
              <button
                type="button"
                className={`request-list__item${
                  isSelected ? " request-list__item--selected" : ""
                }`}
                data-testid={`request-item-${r.id}`}
                aria-pressed={isSelected}
                disabled={claimedByOther}
                onClick={() => props.onSelect(r.id)}
              >
                <span className="request-list__model">{r.model}</span>
                <span className="request-list__preview">{describe(r)}</span>
                <span className="request-list__state">{r.state}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
