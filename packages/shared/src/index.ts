// Wire types shared between server and web. See docs/api-contract.md.

export type ChatRole = "system" | "user" | "assistant" | "tool";

export interface ChatMessage {
  role: ChatRole;
  content: string;
  name?: string;
}

export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  stream?: boolean;
  // Other OpenAI fields are accepted but only carried as metadata.
  [key: string]: unknown;
}

export interface ChatCompletionChoice {
  index: number;
  message: { role: "assistant"; content: string };
  finish_reason: "stop" | "length" | "content_filter" | null;
}

export interface ChatCompletionResponse {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: ChatCompletionChoice[];
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

export interface ChatCompletionChunk {
  id: string;
  object: "chat.completion.chunk";
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: { role?: "assistant"; content?: string };
    finish_reason: "stop" | "length" | "content_filter" | null;
  }>;
}

// Internal request lifecycle.

export type RequestState = "pending" | "claimed" | "completed" | "cancelled";

export interface PendingRequest {
  id: string;
  state: RequestState;
  claimedBy?: string;
  createdAt: string;
  model: string;
  messages: ChatMessage[];
  stream: boolean;
  metadata: Record<string, unknown>;
}

export type QueueEvent =
  | { type: "request.created"; request: PendingRequest }
  | { type: "request.claimed"; id: string; claimedBy: string }
  | { type: "request.completed"; id: string }
  | { type: "request.cancelled"; id: string };
