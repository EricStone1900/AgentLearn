import "dotenv/config";

import { MyLlm } from "../extensions/my-llm.js";

async function main(): Promise<void> {
  const llm = new MyLlm({
    provider: "modelscope",
  });

  console.log("当前模型配置：");
  console.log(llm.getInfo());

  const messages = [
    {
      role: "system" as const,
      content: "你是一个简洁、准确的 TypeScript 助手。",
    },
    {
      role: "user" as const,
      content: "请解释 TypeScript 中接口继承的作用。",
    },
  ];

  const response = await llm.invoke(messages, {
    temperature: 0,
  });

  console.log("\n模型回答：");
  console.log(response);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);

  console.error("调用失败：", message);
  process.exitCode = 1;
});
