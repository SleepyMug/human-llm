import { expect, type Locator, type Page } from "@playwright/test";

const SERVER_PORT = Number(process.env.HUMAN_LLM_SERVER_PORT ?? 8080);
export const SERVER_URL = `http://localhost:${SERVER_PORT}`;

let counter = 0;
// Each scenario uses a unique marker in its user message so the test can
// pick its own request out of the shared queue (other tests, including
// other workers, may also have pending requests).
export function freshMarker(prefix: string): string {
  counter += 1;
  return `${prefix}-${process.pid}-${Date.now()}-${counter}`;
}

// The web app starts in "connecting" state and flips to "open" once the SSE
// channel is up. Tests should wait for this before creating a request, so
// the resulting `request.created` event is delivered (rather than racing
// the initial /api/requests hydrate).
export async function waitForConnected(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByTestId("connection-status")).toHaveText("Connected");
}

// Locate the list item carrying our marker. RequestList renders the last
// message content as the preview, so :has-text(MARKER) finds the right row.
export function requestItem(page: Page, marker: string): Locator {
  return page.locator('[data-testid^="request-item-"]').filter({ hasText: marker });
}

export interface SseFrame {
  data: string;
}

// Parse SSE frames from a response body stream. Each frame's `data:` line(s)
// are concatenated; comment frames (lines starting with ":") are dropped.
// Resolves once the server closes the stream.
export async function readSseFrames(stream: ReadableStream<Uint8Array>): Promise<SseFrame[]> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  const frames: SseFrame[] = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf("\n\n")) !== -1) {
      const raw = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const dataLines = raw
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).replace(/^ /, ""));
      if (dataLines.length === 0) continue;
      frames.push({ data: dataLines.join("\n") });
    }
  }
  return frames;
}
