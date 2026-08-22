import type { FastifyPluginAsync } from "fastify";

export const healthRoutes: FastifyPluginAsync = async (app): Promise<void> => {
  app.get("/health", async () => {
    return {
      status: "ok",
      service: "document-qa-assistant",
    };
  });
};
