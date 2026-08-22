import Fastify, {
  type FastifyInstance,
} from "fastify";
import {
  healthRoutes,
} from "../routes/health.js";

export type AppLogLevel =
  | "fatal"
  | "error"
  | "warn"
  | "info"
  | "debug"
  | "trace"
  | "silent";

export interface CreateAppOptions {
  logger?: boolean;
  loggerLevel?: AppLogLevel;
}

export function createApp(
  options: CreateAppOptions = {},
): FastifyInstance {
  const logger =
    options.logger === true
      ? {
          level:
            options.loggerLevel ?? "info",
        }
      : false;

  const app = Fastify({
    logger,
  });

  app.register(healthRoutes, {
    prefix: "/api",
  });

  return app;
}