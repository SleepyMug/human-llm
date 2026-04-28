import { expect, test } from "@playwright/test";
import {
  freshMarker,
  requestItem,
  SERVER_URL,
  waitForConnected,
} from "./helpers.js";

// Scenario: two browser contexts are connected. A request shows up in both;
// only the context that claims first can answer it. The other gets a 409
// from the API and a "claimed by another session" affordance in the UI.
test.describe("Multi-session: only one browser can claim a given request", () => {
  test("second context sees the claim and is rejected if it tries", async ({
    browser,
    request,
  }) => {
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();

    try {
      await waitForConnected(pageA);
      await waitForConnected(pageB);

      const marker = freshMarker("multi");
      const apiCall = request.post(`${SERVER_URL}/v1/chat/completions`, {
        data: {
          model: "gpt-4",
          messages: [{ role: "user", content: `who claims me? [${marker}]` }],
        },
      });

      // Both contexts see the request. (sessionStorage is per-context, so
      // the two pages have distinct sessionIds.)
      const itemA = requestItem(pageA, marker);
      const itemB = requestItem(pageB, marker);
      await expect(itemA).toBeVisible();
      await expect(itemB).toBeVisible();

      // Context A claims first.
      await itemA.click();
      await expect(pageA.getByTestId("reply-input")).toBeEnabled();

      // Context B's row flips to "claimed" (claimed by the other session)
      // and the button is disabled.
      const itemBButton = itemB.locator("..").locator("button").first();
      await expect(itemB).toContainText("claimed");
      await expect(itemBButton).toBeDisabled();

      // Recover the request id from the data-testid so we can hit /claim
      // directly with a different sessionId and confirm the server returns
      // 409 to a second claimer.
      const testId = await itemB.getAttribute("data-testid");
      expect(testId).not.toBeNull();
      const id = testId!.replace("request-item-", "");

      const claimRes = await ctxB.request.post(
        `${SERVER_URL}/api/requests/${id}/claim`,
        { data: { sessionId: "ctxB-direct" } },
      );
      expect(claimRes.status()).toBe(409);
      const claimBody = await claimRes.json();
      expect(typeof claimBody.error).toBe("string");

      // Context A finishes the request so the held HTTP call resolves
      // cleanly (otherwise the server keeps the connection open until the
      // test teardown closes it).
      const humanReply = `from ctxA [${marker}]`;
      await pageA.getByTestId("reply-input").fill(humanReply);
      await pageA.getByTestId("submit-button").click();

      const apiRes = await apiCall;
      expect(apiRes.status()).toBe(200);
      const body = await apiRes.json();
      expect(body.choices[0].message.content).toBe(humanReply);

      // Both UIs converge on the row being gone.
      await expect(itemA).toHaveCount(0);
      await expect(itemB).toHaveCount(0);
    } finally {
      await ctxA.close();
      await ctxB.close();
    }
  });
});
