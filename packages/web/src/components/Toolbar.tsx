import type { JSX } from "react";
import type { ConnectionState } from "../state/reducer.js";

interface ToolbarProps {
  sessionId: string;
  connection: ConnectionState;
  banner: string | null;
  onDismissBanner: () => void;
}

const labels: Record<ConnectionState, string> = {
  connecting: "Connecting…",
  open: "Connected",
  closed: "Disconnected",
};

export function Toolbar(props: ToolbarProps): JSX.Element {
  const shortSession = props.sessionId.slice(0, 8);
  return (
    <header className="toolbar" data-testid="toolbar">
      <h1 className="toolbar__title">human-llm</h1>
      <span
        className={`toolbar__connection toolbar__connection--${props.connection}`}
        data-testid="connection-status"
      >
        {labels[props.connection]}
      </span>
      <span
        className="toolbar__session"
        data-testid="session-id"
        title={props.sessionId}
      >
        session: {shortSession}
      </span>
      {props.banner !== null && (
        <div className="toolbar__banner" role="status" data-testid="banner">
          <span>{props.banner}</span>
          <button
            type="button"
            onClick={props.onDismissBanner}
            aria-label="Dismiss banner"
          >
            ×
          </button>
        </div>
      )}
    </header>
  );
}
