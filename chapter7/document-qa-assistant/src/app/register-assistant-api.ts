import multipart from "@fastify/multipart";
import type { FastifyInstance } from "fastify";
import { assistantRoutes, type AssistantHttpApi } from "../routes/assistant.js";

export interface RegisterAssistantApiOptions {
  assistant: AssistantHttpApi;
  uploadRoot: string;
  maxUploadBytes: number;
}

export function registerAssistantApi(
  app: FastifyInstance,
  options: RegisterAssistantApiOptions,
): void {
  if (!Number.isInteger(options.maxUploadBytes) || options.maxUploadBytes < 1) {
    throw new Error("maxUploadBytes 必须是正整数");
  }

  app.register(
    async function assistantApiScope(scopedApp): Promise<void> {
      await scopedApp.register(multipart, {
        limits: {
          files: 1,

          fields: 0,

          parts: 1,

          fileSize: options.maxUploadBytes,
        },
      });

      await scopedApp.register(assistantRoutes, {
        assistant: options.assistant,

        uploadRoot: options.uploadRoot,

        maxUploadBytes: options.maxUploadBytes,
      });
    },
    {
      prefix: "/api",
    },
  );
}
