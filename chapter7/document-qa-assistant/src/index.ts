import "dotenv/config";
import { createApp } from "./app/create-app.js";
import { loadAppConfig } from "./config/app-config.js";

const config = loadAppConfig();

const app = createApp({
  logger: config.NODE_ENV !== "test",
});

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;

  shuttingDown = true;

  app.log.info(
    {
      signal,
    },
    "正在关闭文档问答服务",
  );

  try {
    await app.close();
  } catch (error: unknown) {
    app.log.error(
      {
        error,
      },
      "关闭服务失败",
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
  await app.listen({
    host: config.HOST,
    port: config.PORT,
  });
} catch (error: unknown) {
  app.log.error(
    {
      error,
    },
    "启动文档问答服务失败",
  );

  process.exitCode = 1;

  await app.close();
}
