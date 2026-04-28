import { expect, test } from "@playwright/test";
import {
  freshMarker,
  requestItem,
  SERVER_URL,
  waitForConnected,
} from "./helpers.js";

// Scenario: an OpenAI client posts to /v1/chat/completions; a human in the
// browser sees the request, claims it, types a reply, and submits. The
// original HTTP call resolves with a coherent chat.completion JSON body
// containing the human's content.
test.describe("Happy path: API call ↔ human in browser ↔ JSON response", () => {
  test("API client receives a chat.completion body matching the human reply", async ({
    page,
    request,
  }) => {
    await waitForConnected(page);

    const marker = freshMarker("happy");
    const userPrompt = `What is 2+2? [${marker}]`;
    const humanReply = `four [${marker}]`;

    // Fire the OpenAI-style call in parallel; do NOT await yet — the server
    // holds the response open until the human submits.
    const apiCall = request.post(`${SERVER_URL}/v1/chat/completions`, {
      data: {
        model: "gpt-4",
        messages: [{ role: "user", content: userPrompt }],
      },
    });

    // The request shows up in the list. RequestList renders the last
    // message as the preview, which carries our marker.
    const item = requestItem(page, marker);
    await expect(item).toBeVisible();

    // Click to claim. The reply textarea becomes available.
    await item.click();
    const reply = page.getByTestId("reply-input");
    await expect(reply).toBeVisible();
    await expect(reply).toBeEnabled();

    // The conversation pane shows the prompt verbatim.
    await expect(page.getByTestId("messages")).toContainText(userPrompt);

    await reply.fill(humanReply);
    await page.getByTestId("submit-button").click();

    // After submit, our right pane returns to the empty state and the row
    // is dropped from the list.
    await expect(page.getByTestId("request-view-empty")).toBeVisible();
    await expect(item).toHaveCount(0);

    // The held HTTP call now resolves with the OpenAI shape.
    const res = await apiCall;
    expect(res.status()).toBe(200);
    const body = await res.json();

    expect(body).toMatchObject({
      object: "chat.completion",
      model: "gpt-4",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: humanReply },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    });
    expect(typeof body.id).toBe("string");
    expect(body.id.startsWith("chatcmpl-")).toBe(true);
    expect(typeof body.created).toBe("number");
  });
});
