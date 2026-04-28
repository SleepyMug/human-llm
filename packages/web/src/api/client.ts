import type { PendingRequest } from "@human-llm/shared";

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  const parsed: unknown = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const message =
      typeof parsed === "object" && parsed !== null && "error" in parsed
        ? String((parsed as { error?: unknown }).error ?? res.statusText)
        : res.statusText;
    throw new ApiError(res.status, message);
  }
  return parsed as T;
}

export async function fetchRequests(): Promise<PendingRequest[]> {
  const res = await fetch("/api/requests");
  if (!res.ok) throw new ApiError(res.status, res.statusText);
  const body = (await res.json()) as { requests: PendingRequest[] };
  return body.requests;
}

export async function claimRequest(
  id: string,
  sessionId: string,
): Promise<PendingRequest> {
  const body = await postJson<{ request: PendingRequest }>(
    `/api/requests/${encodeURIComponent(id)}/claim`,
    { sessionId },
  );
  return body.request;
}

export async function respondToRequest(
  id: string,
  sessionId: string,
  content: string,
): Promise<PendingRequest> {
  const body = await postJson<{ request: PendingRequest }>(
    `/api/requests/${encodeURIComponent(id)}/respond`,
    { sessionId, content },
  );
  return body.request;
}

export async function cancelRequest(
  id: string,
  sessionId: string,
): Promise<PendingRequest> {
  const body = await postJson<{ request: PendingRequest }>(
    `/api/requests/${encodeURIComponent(id)}/cancel`,
    { sessionId },
  );
  return body.request;
}
