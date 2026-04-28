const STORAGE_KEY = "human-llm.sessionId";

function randomId(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function getSessionId(storage: Storage = sessionStorage): string {
  const existing = storage.getItem(STORAGE_KEY);
  if (existing) return existing;
  const fresh = randomId();
  storage.setItem(STORAGE_KEY, fresh);
  return fresh;
}
