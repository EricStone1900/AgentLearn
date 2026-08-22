import Fastify, { type FastifyInstance } from "fastify";
import { healthRoutes } from "../routes/health.js";

export interface CreateAppOptions {
  logger?: boolean;
}

export function createApp(options: CreateAppOptions = {}): FastifyInstance {
  const app = Fastify({
    logger: options.logger ?? false,
  });

  app.register(healthRoutes, {
    prefix: "/api",
  });

  return app;
}
