import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PendingRequest } from "@human-llm/shared";
import { RequestView } from "./RequestView.js";

function makeRequest(overrides: Partial<PendingRequest> = {}): PendingRequest {
  return {
    id: "req-1",
    state: "pending",
    createdAt: "2026-04-28T00:00:00.000Z",
    model: "human",
    messages: [
      { role: "system", content: "be helpful" },
      { role: "user", content: "hi there" },
    ],
    stream: false,
    metadata: { temperature: 0 },
    ...overrides,
  };
}

describe("RequestView", () => {
  it("shows the empty placeholder when nothing is selected", () => {
    render(
      <RequestView
        request={null}
        sessionId="me"
        isClaimedByMe={false}
        onClaim={() => {}}
        onSubmit={() => {}}
        onDecline={() => {}}
      />,
    );
    expect(screen.getByTestId("request-view-empty")).toBeInTheDocument();
  });

  it("renders the conversation and metadata", () => {
    render(
      <RequestView
        request={makeRequest()}
        sessionId="me"
        isClaimedByMe={false}
        onClaim={() => {}}
        onSubmit={() => {}}
        onDecline={() => {}}
      />,
    );
    expect(screen.getByTestId("messages")).toHaveTextContent("hi there");
    expect(screen.getByTestId("messages")).toHaveTextContent("be helpful");
    expect(screen.getByTestId("request-meta")).toHaveTextContent("temperature");
  });

  it("offers a Claim button for pending requests we don't own", async () => {
    const onClaim = vi.fn().mockResolvedValue(undefined);
    render(
      <RequestView
        request={makeRequest()}
        sessionId="me"
        isClaimedByMe={false}
        onClaim={onClaim}
        onSubmit={() => {}}
        onDecline={() => {}}
      />,
    );
    await userEvent.click(screen.getByTestId("claim-button"));
    expect(onClaim).toHaveBeenCalledWith("req-1");
  });

  it("shows 'claimed by another session' when state is claimed by other", () => {
    render(
      <RequestView
        request={makeRequest({ state: "claimed", claimedBy: "other-session" })}
        sessionId="me"
        isClaimedByMe={false}
        onClaim={() => {}}
        onSubmit={() => {}}
        onDecline={() => {}}
      />,
    );
    expect(screen.getByTestId("claimed-by-other")).toHaveTextContent(
      "other-session",
    );
  });

  it("submits via Cmd+Enter when claimed by us", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(
      <RequestView
        request={makeRequest({ state: "claimed", claimedBy: "me" })}
        sessionId="me"
        isClaimedByMe={true}
        onClaim={() => {}}
        onSubmit={onSubmit}
        onDecline={() => {}}
      />,
    );
    const input = screen.getByTestId("reply-input");
    await user.click(input);
    await user.keyboard("hello world");
    await user.keyboard("{Meta>}{Enter}{/Meta}");
    expect(onSubmit).toHaveBeenCalledWith("req-1", "hello world");
  });

  it("submits via Ctrl+Enter when claimed by us", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(
      <RequestView
        request={makeRequest({ state: "claimed", claimedBy: "me" })}
        sessionId="me"
        isClaimedByMe={true}
        onClaim={() => {}}
        onSubmit={onSubmit}
        onDecline={() => {}}
      />,
    );
    const input = screen.getByTestId("reply-input");
    await user.click(input);
    await user.keyboard("hi");
    await user.keyboard("{Control>}{Enter}{/Control}");
    expect(onSubmit).toHaveBeenCalledWith("req-1", "hi");
  });

  it("disables submit until something is typed", async () => {
    render(
      <RequestView
        request={makeRequest({ state: "claimed", claimedBy: "me" })}
        sessionId="me"
        isClaimedByMe={true}
        onClaim={() => {}}
        onSubmit={() => {}}
        onDecline={() => {}}
      />,
    );
    const submit = screen.getByTestId("submit-button");
    expect(submit).toBeDisabled();
    await userEvent.type(screen.getByTestId("reply-input"), "ok");
    expect(submit).toBeEnabled();
  });

  it("submits when the Submit button is clicked", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <RequestView
        request={makeRequest({ state: "claimed", claimedBy: "me" })}
        sessionId="me"
        isClaimedByMe={true}
        onClaim={() => {}}
        onSubmit={onSubmit}
        onDecline={() => {}}
      />,
    );
    await userEvent.type(screen.getByTestId("reply-input"), "answer");
    await userEvent.click(screen.getByTestId("submit-button"));
    expect(onSubmit).toHaveBeenCalledWith("req-1", "answer");
  });

  it("declines via the decline button", async () => {
    const onDecline = vi.fn().mockResolvedValue(undefined);
    render(
      <RequestView
        request={makeRequest({ state: "claimed", claimedBy: "me" })}
        sessionId="me"
        isClaimedByMe={true}
        onClaim={() => {}}
        onSubmit={() => {}}
        onDecline={onDecline}
      />,
    );
    await userEvent.click(screen.getByTestId("decline-button"));
    expect(onDecline).toHaveBeenCalledWith("req-1");
  });

  it("shows error feedback when submit rejects", async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error("boom"));
    render(
      <RequestView
        request={makeRequest({ state: "claimed", claimedBy: "me" })}
        sessionId="me"
        isClaimedByMe={true}
        onClaim={() => {}}
        onSubmit={onSubmit}
        onDecline={() => {}}
      />,
    );
    await userEvent.type(screen.getByTestId("reply-input"), "hi");
    await userEvent.click(screen.getByTestId("submit-button"));
    expect(await screen.findByTestId("error")).toHaveTextContent("boom");
  });
});
