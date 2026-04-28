import type { FastifyInstance, FastifyReply } from "fastify";
import { Queue, QueueError } from "../queue/queue.js";

export interface InternalRouteDeps {
  queue: Queue;
}

const sessionBodySchema = {
  type: "object",
  required: ["sessionId"],
  properties: { sessionId: { type: "string", minLength: 1 } },
} as const;

const respondBodySchema = {
  type: "object",
  required: ["sessionId", "content"],
  properties: {
    sessionId: { type: "string", minLength: 1 },
    content: { type: "string" },
  },
} as const;

const idParamsSchema = {
  type: "object",
  required: ["id"],
  properties: { id: { type: "string", minLength: 1 } },
} as const;

interface IdParams { id: string }
interface SessionBody { sessionId: string }
interface RespondBody { sessionId: string; content: string }

function mapQueueError(reply: FastifyReply, err: QueueError): { error: string } {
  switch (err.code) {
    case "not_found":
    case "terminal":
      reply.code(404);
      return { error: err.message };
    case "already_claimed":
    case "not_claimed":
    case "wrong_session":
      reply.code(409);
      return { error: err.message };
  }
}

export function registerInternalRoutes(
  app: FastifyInstance,
  deps: InternalRouteDeps,
): void {
  app.get("/api/requests", async () => ({ requests: deps.queue.list() }));

  app.post<{ Params: IdParams; Body: SessionBody }>(
    "/api/requests/:id/claim",
    { schema: { params: idParamsSchema, body: sessionBodySchema } },
    async (req, reply) => {
      try {
        const r = deps.queue.claim(req.params.id, req.body.sessionId);
        return { request: r };
      } catch (err) {
        if (err instanceof QueueError) return mapQueueError(reply, err);
        throw err;
      }
    },
  );

  app.post<{ Params: IdParams; Body: RespondBody }>(
    "/api/requests/:id/respond",
    { schema: { params: idParamsSchema, body: respondBodySchema } },
    async (req, reply) => {
      try {
        const r = deps.queue.complete(
          req.params.id,
          req.body.sessionId,
          req.body.content,
        );
        return { request: r };
      } catch (err) {
        if (err instanceof QueueError) return mapQueueError(reply, err);
        throw err;
      }
    },
  );

  app.post<{ Params: IdParams; Body: SessionBody }>(
    "/api/requests/:id/cancel",
    { schema: { params: idParamsSchema, body: sessionBodySchema } },
    async (req, reply) => {
      const { id } = req.params;
      const { sessionId } = req.body;
      const current = deps.queue.get(id);
      if (!current) {
        reply.code(404);
        return { error: `request ${id} not found` };
      }
      if (current.state === "completed" || current.state === "cancelled") {
        reply.code(404);
        return { error: `request ${id} is ${current.state}` };
      }
      if (current.state !== "claimed") {
        reply.code(409);
        return { error: `request ${id} is ${current.state}, not claimed` };
      }
      if (current.claimedBy !== sessionId) {
        reply.code(409);
        return { error: `request ${id} not claimed by ${sessionId}` };
      }
      try {
        const r = deps.queue.cancel(id, sessionId, "human_declined");
        return { request: r };
      } catch (err) {
        if (err instanceof QueueError) return mapQueueError(reply, err);
        throw err;
      }
    },
  );
}
