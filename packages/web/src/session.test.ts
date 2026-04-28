import { beforeEach, describe, expect, it } from "vitest";
import { getSessionId } from "./session.js";

class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  clear() {
    this.map.clear();
  }
  getItem(key: string) {
    return this.map.get(key) ?? null;
  }
  key(i: number) {
    return Array.from(this.map.keys())[i] ?? null;
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
  setItem(key: string, value: string) {
    this.map.set(key, value);
  }
}

describe("getSessionId", () => {
  let storage: MemoryStorage;
  beforeEach(() => {
    storage = new MemoryStorage();
  });

  it("creates and persists a fresh id", () => {
    const id = getSessionId(storage);
    expect(id).toMatch(/^[0-9a-f]{24}$/);
    expect(storage.getItem("human-llm.sessionId")).toBe(id);
  });

  it("reuses an existing id", () => {
    const a = getSessionId(storage);
    const b = getSessionId(storage);
    expect(a).toBe(b);
  });
});
