import "dotenv/config";
import type { FastifyInstance } from "fastify";
import { createApp } from "./app/create-app.js";
import {
  createAssistantRuntime,
  type AssistantRuntime,
} from "./app/assistant-runtime.js";
import { loadAppConfig, toSafeConfigSummary } from "./config/app-config.js";
import { registerAssistantApi } from "./app/register-assistant-api.js";

const config = loadAppConfig();

const app: FastifyInstance = createApp({
  logger: config.server.nodeEnv !== "test",

  loggerLevel: config.server.logLevel,
});

let runtime: AssistantRuntime | undefined;

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;

  app.log.info(
    {
      signal,
    },
    "正在关闭文档问答服务",
  );

  const errors: unknown[] = [];

  /*
   * 先停止 HTTP 服务，不再接收新请求。
   */
  try {
    await app.close();
  } catch (error: unknown) {
    errors.push(error);
  }

  /*
   * 再关闭数据库和外部资源。
   */
  if (runtime) {
    try {
      await runtime.close();
    } catch (error: unknown) {
      errors.push(error);
    }
  }

  if (errors.length > 0) {
    app.log.error(
      {
        error: new AggregateError(errors, "关闭应用失败"),
      },
      "文档问答服务关闭失败",
    );

    process.exitCode = 1;
  }
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void shutdown(signal);
  });
}

try {
  app.log.info(toSafeConfigSummary(config), "文档问答应用配置加载完成");

  runtime = await createAssistantRuntime(config);
  registerAssistantApi(app, {
    assistant: runtime.assistant,

    uploadRoot: config.files.uploadRoot,

    maxUploadBytes: config.files.maxUploadBytes,
  });

  app.log.info(
    {
      userId: runtime.memory.manager.getUserId(),

      namespace: runtime.assistant.getNamespace(),

      tools: runtime.tools.listNames(),
    },
    "AssistantRuntime 初始化完成",
  );

  await app.listen({
    host: config.server.host,

    port: config.server.port,
  });
} catch (error: unknown) {
  app.log.error(
    {
      error,
    },
    "启动文档问答服务失败",
  );

  process.exitCode = 1;

  await shutdown("STARTUP_ERROR");
}
