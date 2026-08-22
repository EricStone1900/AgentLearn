import "dotenv/config";
import {
  createAssistantRuntime,
  type AssistantRuntime,
} from "../app/assistant-runtime.js";
import { loadAppConfig } from "../config/app-config.js";

let runtime: AssistantRuntime | undefined;

try {
  const config = loadAppConfig();

  runtime = await createAssistantRuntime(config);

  console.log(
    JSON.stringify(
      {
        success: true,
        message: "AssistantRuntime 初始化成功",

        userId: runtime.memory.manager.getUserId(),

        tools: runtime.tools.listNames(),

        sessionId: runtime.assistant.getSessionId(),

        namespace: runtime.assistant.getNamespace(),
      },
      null,
      2,
    ),
  );
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : String(error);

  console.error(
    JSON.stringify(
      {
        success: false,
        message,
      },
      null,
      2,
    ),
  );

  process.exitCode = 1;
} finally {
  if (runtime) {
    try {
      await runtime.close();
    } catch (error: unknown) {
      console.error("关闭 Runtime 失败：", error);

      process.exitCode = 1;
    }
  }
}
