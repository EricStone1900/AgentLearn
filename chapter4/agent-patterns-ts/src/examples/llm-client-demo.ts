import { loadConfig } from "../core/config.js";
import { OpenAiLlmClient } from "../core/openai-llm.js";

async function main(): Promise<void> {
  // 读取配置
  const config = loadConfig();
  // 创建客户端
  const llmClient = new OpenAiLlmClient(config);
  // 准备消息
  const exampleMessages = [
    {
      role: "system" as const,
      content: "You are a helpful assistant that writes TypeScript code.",
    },
    {
      role: "user" as const,
      content: "使用 TypeScript 写一个快速排序算法，并简单解释。",
    },
  ];
  // 调用模型
  console.log("--- 调用 LLM ---");

  const responseText = await llmClient.generate(exampleMessages, 0);
  // 打印完整结果
  console.log("\n--- 完整模型响应 ---");
  console.log(responseText);
}

main().catch((error: unknown) => {
  const message =
    error instanceof Error ? error.message : String(error);

  console.error("测试运行失败：", message);
  process.exitCode = 1;
});