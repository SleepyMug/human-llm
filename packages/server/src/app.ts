import Fastify, { type FastifyInstance } from "fastify";
import { Queue } from "./queue/queue.js";
import { registerInternalRoutes } from "./routes/api.js";
import { registerEventsRoute } from "./routes/events.js";
import { registerOpenaiRoutes } from "./routes/openai.js";
import { generateRequestId } from "./util/ids.js";

export interface BuildAppOptions {
  logger?: boolean;
  generateId?: () => string;
}

export interface BuiltApp {
  server: FastifyInstance;
  queue: Queue;
}

export function buildApp(options: BuildAppOptions = {}): BuiltApp {
  const server = Fastify({ logger: options.logger ?? false });
  const queue = new Queue();
  const generateId = options.generateId ?? generateRequestId;
  registerOpenaiRoutes(server, { queue, generateId });
  registerInternalRoutes(server, { queue });
  registerEventsRoute(server, { queue });
  return { server, queue };
}
