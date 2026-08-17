// import { loadConfig } from "../core/config.js";
// import { OpenAiLlmClient } from "../core/openai-llm.js";
import "dotenv/config";
import { HelloAgentsLlm } from "../core/hello-agents-llm.js";

async function main(): Promise<void> {
  // // 读取配置
  // const config = loadConfig();
  // // 创建客户端
  // const llmClient = new OpenAiLlmClient(config);
  const llmClient = new HelloAgentsLlm();

  console.log("当前 LLM 配置：");
  console.log(llmClient.getInfo());

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

  // const responseText = await llmClient.generate(exampleMessages, 0);
  // 非流式调用
  const responseText = await llmClient.invoke(exampleMessages, {
    temperature: 0,
  });

  // 流式调用
  // for await (const chunk of llmClient.streamInvoke(exampleMessages, {
  //   temperature: 0,
  // })) {
  //   process.stdout.write(chunk);
  // }

  // process.stdout.write("\n");

  console.log(responseText);

  // 打印完整结果
  console.log("\n--- 完整模型响应 ---");
  console.log(responseText);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);

  console.error("测试运行失败：", message);
  process.exitCode = 1;
});
