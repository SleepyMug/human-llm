import { expect, test } from "@playwright/test";
import {
  freshMarker,
  requestItem,
  SERVER_URL,
  waitForConnected,
} from "./helpers.js";

// Scenario: the API client disconnects before a human submits. The server
// receives the socket close, cancels the queued request, and the browser
// removes the row from the list. If a human had claimed the request, they
// also see the cancellation banner.
test.describe("Cancellation: API client disconnect propagates to the UI", () => {
  test("aborting while pending removes the request from the list", async ({
    page,
  }) => {
    await waitForConnected(page);

    const marker = freshMarker("cancel-pending");
    const ctrl = new AbortController();
    const apiPromise = fetch(`${SERVER_URL}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4",
        messages: [{ role: "user", content: `pending then abort [${marker}]` }],
      }),
      signal: ctrl.signal,
    }).catch(() => undefined);

    const item = requestItem(page, marker);
    await expect(item).toBeVisible();

    ctrl.abort();
    await apiPromise;

    // Server cancels on socket close → SSE request.cancelled event →
    // reducer drops the request from state.
    await expect(item).toHaveCount(0);
  });

  test("aborting after a human claims surfaces a cancellation banner", async ({
    page,
  }) => {
    await waitForConnected(page);

    const marker = freshMarker("cancel-claimed");
    const ctrl = new AbortController();
    const apiPromise = fetch(`${SERVER_URL}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4",
        messages: [{ role: "user", content: `claim then abort [${marker}]` }],
      }),
      signal: ctrl.signal,
    }).catch(() => undefined);

    const item = requestItem(page, marker);
    await expect(item).toBeVisible();
    await item.click();
    await expect(page.getByTestId("reply-input")).toBeEnabled();

    ctrl.abort();
    await apiPromise;

    // The right-hand pane returns to empty state, the row is gone, and the
    // toolbar surfaces a banner so the human knows the API client gave up.
    await expect(page.getByTestId("request-view-empty")).toBeVisible();
    await expect(item).toHaveCount(0);
    await expect(page.getByTestId("banner")).toContainText(
      "cancelled by the API client",
    );
  });
});
