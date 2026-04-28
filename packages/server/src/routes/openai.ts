import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatMessage,
} from "@human-llm/shared";
import type { Queue } from "../queue/queue.js";
import { CancelledError } from "../queue/queue.js";
import { openAiError } from "../util/errors.js";

export interface OpenaiRouteDeps {
  queue: Queue;
  generateId: () => string;
}

const chatBodySchema = {
  type: "object",
  required: ["model", "messages"],
  properties: {
    model: { type: "string", minLength: 1 },
    messages: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        required: ["role", "content"],
        properties: {
          role: { type: "string" },
          content: { type: "string" },
          name: { type: "string" },
        },
      },
    },
    stream: { type: "boolean" },
  },
} as const;

const CONTROL_FIELDS = new Set(["model", "messages", "stream"]);

function extractMetadata(body: Record<string, unknown>): Record<string, unknown> {
  const metadata: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (!CONTROL_FIELDS.has(k)) metadata[k] = v;
  }
  return metadata;
}

export function registerOpenaiRoutes(
  app: FastifyInstance,
  deps: OpenaiRouteDeps,
): void {
  app.get("/v1/models", async () => ({
    object: "list",
    data: [
      {
        id: "human",
        object: "model",
        created: 0,
        owned_by: "human-llm",
      },
    ],
  }));

  app.post(
    "/v1/chat/completions",
    { schema: { body: chatBodySchema } },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const body = req.body as ChatCompletionRequest;
      const stream = body.stream === true;
      if (stream) {
        reply.code(501);
        return openAiError(
          "Streaming responses are not yet implemented",
          "invalid_request_error",
          "stream_not_implemented",
        );
      }

      const id = deps.generateId();
      const messages = body.messages as ChatMessage[];
      deps.queue.create({
        id,
        model: body.model,
        messages,
        stream: false,
        metadata: extractMetadata(body as Record<string, unknown>),
      });

      let clientClosed = false;
      const onClose = () => {
        // The response stream's 'close' event distinguishes premature
        // disconnects (writableEnded === false) from a normal end-of-
        // response close that fires after we send the reply.
        if (reply.raw.writableEnded) return;
        clientClosed = true;
        deps.queue.cancel(id, undefined, "client_disconnected");
      };
      reply.raw.on("close", onClose);

      try {
        const content = await deps.queue.wait(id);
        reply.raw.off("close", onClose);
        const response: ChatCompletionResponse = {
          id,
          object: "chat.completion",
          created: Math.floor(Date.now() / 1000),
          model: body.model,
          choices: [
            {
              index: 0,
              message: { role: "assistant", content },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        };
        return response;
      } catch (err) {
        reply.raw.off("close", onClose);
        if (clientClosed) {
          // Socket is gone; abandon the reply so Fastify doesn't try to
          // write to a dead connection.
          reply.hijack();
          return;
        }
        if (err instanceof CancelledError) {
          reply.code(499);
          return openAiError(
            `request cancelled: ${err.reason}`,
            "server_error",
            err.reason,
          );
        }
        throw err;
      }
    },
  );
}
