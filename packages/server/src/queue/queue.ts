import { EventEmitter } from "node:events";
import type {
  ChatMessage,
  PendingRequest,
  QueueEvent,
} from "@human-llm/shared";

export type QueueErrorCode =
  | "not_found"
  | "already_claimed"
  | "terminal"
  | "not_claimed"
  | "wrong_session";

export class QueueError extends Error {
  readonly code: QueueErrorCode;
  constructor(code: QueueErrorCode, message: string) {
    super(message);
    this.name = "QueueError";
    this.code = code;
  }
}

export class CancelledError extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super(`request cancelled: ${reason}`);
    this.name = "CancelledError";
    this.reason = reason;
  }
}

export interface CreateInput {
  id: string;
  model: string;
  messages: ChatMessage[];
  stream: boolean;
  metadata: Record<string, unknown>;
}

interface Entry {
  request: PendingRequest;
  done: Promise<string>;
  resolveDone: (content: string) => void;
  rejectDone: (err: CancelledError) => void;
}

export type QueueListener = (event: QueueEvent) => void;

export class Queue {
  private readonly entries = new Map<string, Entry>();
  private readonly emitter = new EventEmitter();

  create(input: CreateInput): PendingRequest {
    if (this.entries.has(input.id)) {
      throw new QueueError("already_claimed", `request ${input.id} already exists`);
    }
    const request: PendingRequest = {
      id: input.id,
      state: "pending",
      createdAt: new Date().toISOString(),
      model: input.model,
      messages: input.messages,
      stream: input.stream,
      metadata: input.metadata,
    };
    let resolveDone!: (content: string) => void;
    let rejectDone!: (err: CancelledError) => void;
    const done = new Promise<string>((resolve, reject) => {
      resolveDone = resolve;
      rejectDone = reject;
    });
    // Swallow unhandled rejection if no caller awaits; callers that do
    // await `wait(id)` still see the rejection on their own chained handle.
    done.catch(() => {});
    this.entries.set(request.id, { request, done, resolveDone, rejectDone });
    this.emit({ type: "request.created", request });
    return request;
  }

  claim(id: string, sessionId: string): PendingRequest {
    const r = this.requireRequest(id);
    if (r.state === "completed" || r.state === "cancelled") {
      throw new QueueError("terminal", `request ${id} is ${r.state}`);
    }
    if (r.state === "claimed") {
      if (r.claimedBy === sessionId) return r;
      throw new QueueError("already_claimed", `request ${id} already claimed`);
    }
    r.state = "claimed";
    r.claimedBy = sessionId;
    this.emit({ type: "request.claimed", id, claimedBy: sessionId });
    return r;
  }

  release(id: string): PendingRequest {
    const r = this.requireRequest(id);
    if (r.state !== "claimed") {
      throw new QueueError("not_claimed", `request ${id} is ${r.state}, not claimed`);
    }
    r.state = "pending";
    delete r.claimedBy;
    return r;
  }

  complete(id: string, sessionId: string, content: string): PendingRequest {
    const entry = this.entries.get(id);
    if (!entry) throw new QueueError("not_found", `request ${id} not found`);
    const r = entry.request;
    if (r.state === "completed" || r.state === "cancelled") {
      throw new QueueError("terminal", `request ${id} is ${r.state}`);
    }
    if (r.state !== "claimed") {
      throw new QueueError("not_claimed", `request ${id} is ${r.state}, not claimed`);
    }
    if (r.claimedBy !== sessionId) {
      throw new QueueError("wrong_session", `request ${id} not claimed by ${sessionId}`);
    }
    r.state = "completed";
    delete r.claimedBy;
    entry.resolveDone(content);
    this.emit({ type: "request.completed", id });
    return r;
  }

  cancel(id: string, sessionId: string | undefined, reason: string): PendingRequest | undefined {
    const entry = this.entries.get(id);
    if (!entry) return undefined;
    const r = entry.request;
    if (r.state === "completed" || r.state === "cancelled") return r;
    if (sessionId !== undefined && r.state === "claimed" && r.claimedBy !== sessionId) {
      throw new QueueError("wrong_session", `request ${id} not claimed by ${sessionId}`);
    }
    r.state = "cancelled";
    delete r.claimedBy;
    entry.rejectDone(new CancelledError(reason));
    this.emit({ type: "request.cancelled", id });
    return r;
  }

  get(id: string): PendingRequest | undefined {
    return this.entries.get(id)?.request;
  }

  list(): PendingRequest[] {
    return Array.from(this.entries.values()).map((e) => e.request);
  }

  wait(id: string): Promise<string> {
    const entry = this.entries.get(id);
    if (!entry) {
      return Promise.reject(new QueueError("not_found", `request ${id} not found`));
    }
    return entry.done;
  }

  on(handler: QueueListener): () => void {
    this.emitter.on("event", handler);
    return () => this.emitter.off("event", handler);
  }

  private emit(event: QueueEvent): void {
    this.emitter.emit("event", event);
  }

  private requireRequest(id: string): PendingRequest {
    const entry = this.entries.get(id);
    if (!entry) throw new QueueError("not_found", `request ${id} not found`);
    return entry.request;
  }
}
