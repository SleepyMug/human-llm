import { expect, test } from "@playwright/test";
import {
  freshMarker,
  readSseFrames,
  requestItem,
  SERVER_URL,
  waitForConnected,
} from "./helpers.js";

// Scenario: same flow as the happy path, but the API client sets
// stream: true. Assert the SSE chunk sequence: an initial role chunk, then
// a content chunk carrying the human reply, then a finish_reason: "stop"
// chunk, then a literal `[DONE]` frame.
test.describe("Streaming: API client receives the right SSE chunk sequence", () => {
  test("role → content → stop → [DONE]", async ({ page }) => {
    await waitForConnected(page);

    const marker = freshMarker("stream");
    const userPrompt = `stream me a reply [${marker}]`;
    const humanReply = `streamed: ${marker}`;
    const model = "gpt-4o";

    // Use raw fetch so we can read the response body incrementally and
    // observe the closing [DONE] frame.
    const fetchPromise = fetch(`${SERVER_URL}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: userPrompt }],
        stream: true,
      }),
    });

    const item = requestItem(page, marker);
    await expect(item).toBeVisible();

    await item.click();
    const reply = page.getByTestId("reply-input");
    await expect(reply).toBeEnabled();

    // The UI shows stream: true in the metadata pane.
    await expect(page.getByTestId("request-meta")).toContainText("stream");

    await reply.fill(humanReply);
    await page.getByTestId("submit-button").click();

    const res = await fetchPromise;
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/event-stream/);

    if (res.body === null) throw new Error("expected an SSE response body");
    const frames = await readSseFrames(res.body);

    // The terminator is always the literal sentinel.
    expect(frames.at(-1)?.data).toBe("[DONE]");

    // Every other frame is a chat.completion.chunk JSON.
    const chunks = frames.slice(0, -1).map((f) => JSON.parse(f.data));
    expect(chunks.length).toBeGreaterThanOrEqual(3);

    for (const c of chunks) {
      expect(c.object).toBe("chat.completion.chunk");
      expect(c.model).toBe(model);
      expect(typeof c.id).toBe("string");
      expect(c.choices).toHaveLength(1);
      expect(c.choices[0].index).toBe(0);
    }

    // First chunk: the role-opening delta.
    expect(chunks[0].choices[0].delta).toEqual({ role: "assistant" });
    expect(chunks[0].choices[0].finish_reason).toBeNull();

    // A middle chunk delivers the human's content verbatim.
    const contentIdx = chunks.findIndex(
      (c) => typeof c.choices[0].delta?.content === "string",
    );
    expect(contentIdx).toBeGreaterThan(0);
    expect(chunks[contentIdx].choices[0].delta.content).toBe(humanReply);
    expect(chunks[contentIdx].choices[0].finish_reason).toBeNull();

    // The final non-DONE chunk carries finish_reason: "stop".
    const stopChunk = chunks.at(-1);
    expect(stopChunk?.choices[0].finish_reason).toBe("stop");
    // Stop chunk's delta is empty.
    expect(stopChunk?.choices[0].delta).toEqual({});

    // Sanity: stop comes after content.
    expect(chunks.indexOf(stopChunk!)).toBeGreaterThan(contentIdx);

    // All chunks share the same id.
    const id = chunks[0].id;
    for (const c of chunks) expect(c.id).toBe(id);
  });
});
