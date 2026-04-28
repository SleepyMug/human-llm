import type { Writable } from "node:stream";

export function formatSseFrame(data: string): string {
  return `data: ${data}\n\n`;
}

export const SSE_DONE_FRAME = "data: [DONE]\n\n";

export function writeSseJson(stream: Writable, data: unknown): void {
  stream.write(formatSseFrame(JSON.stringify(data)));
}

export function writeSseDone(stream: Writable): void {
  stream.write(SSE_DONE_FRAME);
}
