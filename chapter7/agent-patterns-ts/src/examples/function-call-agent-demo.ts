import "dotenv/config";

import { FunctionCallAgent } from "../agents/function-call/function-call-agent.js";

import { HelloAgentsLlm } from "../core/hello-agents-llm.js";

import { createDefaultToolRegistry } from "../tools/create-default-registry.js";

async function main(): Promise<void> {
  /*
   * 第一步：创建支持原生 Function Calling 的 LLM。
   *
   * 这里必须使用实现了
   * NativeToolCallingLlmClient 的客户端。
   */
  const llm = new HelloAgentsLlm();

  /*
   * 第二步：创建默认工具注册表。
   */
  const tools = createDefaultToolRegistry();

  console.log("--- FunctionCallAgent 可用工具 ---");
  console.log(tools.describeWithSchemas());

  console.log("\n--- OpenAI Tool Schema ---");
  console.log(JSON.stringify(tools.toOpenAiTools(), null, 2));

  /*
   * 第三步：把注册表传给 FunctionCallAgent。
   *
   * 参数名称是 toolRegistry。
   */
  const agent = new FunctionCallAgent({
    name: "原生工具调用助手",
    llm,

    toolRegistry: tools,

    enableToolCalling: true,

    defaultToolChoice: "auto",

    maxToolIterations: 5,

    systemPrompt: [
      "你是一个严谨的工具调用助手。",
      "需要准确计算或搜索实时信息时，应调用工具。",
      "复杂计算可以连续调用多次工具。",
      "不要自行编造工具执行结果。",
    ].join(""),
  });

  /*
   * 第四步：调用 Agent。
   */
  const result = await agent.run("请计算 sqrt(16) + 2 * 3，并说明计算过程。");

  console.log("\n--- FunctionCallAgent 最终结果 ---");
  console.log(result.answer);

  console.log("\n--- LLM 调用次数 ---");
  console.log(result.steps);

  console.log("\n--- 对话历史 ---");
  console.log(
    agent
      .getHistory()
      .map((message) => message.toString())
      .join("\n"),
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);

  console.error("\nFunctionCallAgent 运行失败：");

  console.error(message);

  process.exitCode = 1;
});
