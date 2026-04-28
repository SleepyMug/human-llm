import type { FastifyInstance } from "fastify";
import type { Queue } from "../queue/queue.js";
import { writeSseJson } from "../util/sse.js";

export interface EventsRouteDeps {
  queue: Queue;
}

interface EventsQuery {
  sessionId?: string;
}

const querySchema = {
  type: "object",
  properties: { sessionId: { type: "string" } },
} as const;

export function registerEventsRoute(
  app: FastifyInstance,
  deps: EventsRouteDeps,
): void {
  app.get<{ Querystring: EventsQuery }>(
    "/api/events",
    { schema: { querystring: querySchema } },
    async (req, reply) => {
      const sessionId = req.query.sessionId;

      reply.hijack();
      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      // Some proxies and `fetch` clients only surface the response after the
      // first body byte arrives. A leading SSE comment flushes headers.
      reply.raw.write(": ok\n\n");

      const off = deps.queue.on((event) => {
        if (reply.raw.writableEnded) return;
        writeSseJson(reply.raw, event);
      });

      const onClose = () => {
        off();
        if (sessionId !== undefined) {
          for (const r of deps.queue.list()) {
            if (r.state === "claimed" && r.claimedBy === sessionId) {
              try {
                deps.queue.release(r.id);
              } catch {
                // State changed concurrently; nothing to do.
              }
            }
          }
        }
      };
      reply.raw.on("close", onClose);
    },
  );
}
