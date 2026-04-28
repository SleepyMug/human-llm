import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PendingRequest } from "@human-llm/shared";
import { RequestList } from "./RequestList.js";

function makeRequest(overrides: Partial<PendingRequest> = {}): PendingRequest {
  return {
    id: "req-1",
    state: "pending",
    createdAt: "2026-04-28T00:00:00.000Z",
    model: "human",
    messages: [{ role: "user", content: "hello" }],
    stream: false,
    metadata: {},
    ...overrides,
  };
}

describe("RequestList", () => {
  it("shows the empty state when there are no requests", () => {
    render(
      <RequestList
        requests={[]}
        selectedId={null}
        sessionId="me"
        onSelect={() => {}}
      />,
    );
    expect(screen.getByTestId("status")).toHaveTextContent("No requests pending.");
  });

  it("renders requests and calls onSelect on click", async () => {
    const onSelect = vi.fn();
    render(
      <RequestList
        requests={[makeRequest({ id: "a" }), makeRequest({ id: "b" })]}
        selectedId={null}
        sessionId="me"
        onSelect={onSelect}
      />,
    );
    await userEvent.click(screen.getByTestId("request-item-b"));
    expect(onSelect).toHaveBeenCalledWith("b");
  });

  it("disables items claimed by another session", async () => {
    const onSelect = vi.fn();
    render(
      <RequestList
        requests={[
          makeRequest({ id: "a", state: "claimed", claimedBy: "other" }),
        ]}
        selectedId={null}
        sessionId="me"
        onSelect={onSelect}
      />,
    );
    const item = screen.getByTestId("request-item-a");
    expect(item).toBeDisabled();
    await userEvent.click(item).catch(() => {});
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("marks the selected item with aria-pressed", () => {
    render(
      <RequestList
        requests={[makeRequest({ id: "a" })]}
        selectedId="a"
        sessionId="me"
        onSelect={() => {}}
      />,
    );
    expect(screen.getByTestId("request-item-a")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("truncates long previews", () => {
    const long = "x".repeat(200);
    render(
      <RequestList
        requests={[
          makeRequest({ id: "a", messages: [{ role: "user", content: long }] }),
        ]}
        selectedId={null}
        sessionId="me"
        onSelect={() => {}}
      />,
    );
    const item = screen.getByTestId("request-item-a");
    expect(item.textContent ?? "").toContain("…");
  });
});
