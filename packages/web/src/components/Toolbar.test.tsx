import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Toolbar } from "./Toolbar.js";

describe("Toolbar", () => {
  it("renders session id (truncated) and connection state", () => {
    render(
      <Toolbar
        sessionId="abcdef0123456789"
        connection="open"
        banner={null}
        onDismissBanner={() => {}}
      />,
    );
    expect(screen.getByTestId("session-id").textContent).toMatch(/abcdef01/);
    expect(screen.getByTestId("connection-status")).toHaveTextContent(
      "Connected",
    );
  });

  it("shows the connecting label", () => {
    render(
      <Toolbar
        sessionId="x"
        connection="connecting"
        banner={null}
        onDismissBanner={() => {}}
      />,
    );
    expect(screen.getByTestId("connection-status")).toHaveTextContent(
      "Connecting",
    );
  });

  it("renders banner and dismisses on click", async () => {
    const onDismiss = vi.fn();
    render(
      <Toolbar
        sessionId="x"
        connection="open"
        banner="cancelled by client"
        onDismissBanner={onDismiss}
      />,
    );
    expect(screen.getByTestId("banner")).toHaveTextContent("cancelled by client");
    await userEvent.click(screen.getByLabelText("Dismiss banner"));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("hides banner when null", () => {
    render(
      <Toolbar
        sessionId="x"
        connection="open"
        banner={null}
        onDismissBanner={() => {}}
      />,
    );
    expect(screen.queryByTestId("banner")).toBeNull();
  });
});
