import { describe, expect, it } from "vitest";
import { generateRequestId } from "./ids.js";

describe("generateRequestId", () => {
  it("starts with chatcmpl- and has random suffix", () => {
    const id = generateRequestId();
    expect(id).toMatch(/^chatcmpl-[A-Za-z0-9_-]+$/);
    expect(id.length).toBeGreaterThan("chatcmpl-".length);
  });

  it("returns distinct values across calls", () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateRequestId()));
    expect(ids.size).toBe(100);
  });
});
