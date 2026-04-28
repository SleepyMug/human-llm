import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import {
  SSE_DONE_FRAME,
  formatSseFrame,
  writeSseDone,
  writeSseJson,
} from "./sse.js";

describe("sse helpers", () => {
  it("formatSseFrame wraps data with the SSE envelope", () => {
    expect(formatSseFrame("hello")).toBe("data: hello\n\n");
  });

  it("SSE_DONE_FRAME terminates a stream", () => {
    expect(SSE_DONE_FRAME).toBe("data: [DONE]\n\n");
  });

  it("writeSseJson serialises and writes", () => {
    const s = new PassThrough();
    const chunks: string[] = [];
    s.on("data", (c) => chunks.push(c.toString()));
    writeSseJson(s, { hello: "world" });
    s.end();
    expect(chunks.join("")).toBe('data: {"hello":"world"}\n\n');
  });

  it("writeSseDone writes the [DONE] frame", () => {
    const s = new PassThrough();
    const chunks: string[] = [];
    s.on("data", (c) => chunks.push(c.toString()));
    writeSseDone(s);
    s.end();
    expect(chunks.join("")).toBe("data: [DONE]\n\n");
  });
});
