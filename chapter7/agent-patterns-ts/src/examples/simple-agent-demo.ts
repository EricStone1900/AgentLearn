import "dotenv/config";

import { SimpleAgent } from "../agents/simple/simple-agent.js";

import { HelloAgentsLlm } from "../core/hello-agents-llm.js";

import { createDefaultToolRegistry } from "../tools/create-default-registry.js";

async function main(): Promise<void> {
  /*
   * 第一步：创建统一 LLM。
   */
  const llm = new HelloAgentsLlm();

  /*
   * 第二步：创建已经注册好工具的注册表。
   *
   * 默认包含：
   * - advanced_calculator
   * - search（配置搜索 API Key 时）
   */
  const tools = createDefaultToolRegistry();

  console.log("--- SimpleAgent 可用工具 ---");
  console.log(tools.describeWithSchemas());

  /*
   * 第三步：把注册表传给 SimpleAgent。
   *
   * SimpleAgent 的参数名称是 toolRegistry。
   */
  const agent = new SimpleAgent({
    name: "Simple 工具助手",
    llm,

    toolRegistry: tools,

    enableToolCalling: true,

    maxToolIterations: 5,

    systemPrompt: [
      "你是一个严谨的数学助手。",
      "遇到数学问题时，应使用工具获得准确结果。",
      "复杂计算可以拆成多个工具调用。",
    ].join(""),
  });

  /*
   * 第四步：调用 Agent。
   */
  const result = await agent.run("请计算 sqrt(16) + 2 * 3，并说明计算步骤。");

  console.log("\n--- SimpleAgent 最终答案 ---");
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

  console.error("\nSimpleAgent 运行失败：");
  console.error(message);

  process.exitCode = 1;
});
