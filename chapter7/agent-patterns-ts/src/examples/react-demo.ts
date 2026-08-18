import "dotenv/config";

import { ReActAgent } from "../agents/react/react-agent.js";

import { HelloAgentsLlm } from "../core/hello-agents-llm.js";

import { createDefaultToolRegistry } from "../tools/create-default-registry.js";

async function main(): Promise<void> {
  /*
   * 第一步：创建 LLM。
   */
  const llm = new HelloAgentsLlm();

  /*
   * 第二步：创建工具注册表。
   */
  const tools = createDefaultToolRegistry();

  console.log("--- ReActAgent 可用工具 ---");
  console.log(tools.describeWithSchemas());

  /*
   * 第三步：读取命令行问题。
   */
  const commandLineQuestion = process.argv.slice(2).join(" ").trim();

  const defaultQuestion = "请计算 sqrt(16) + 2 * 3，并说明每一步结果。";

  const question = commandLineQuestion || defaultQuestion;

  console.log("\n--- 用户问题 ---");
  console.log(question);

  /*
   * 第四步：把注册表传入 ReActAgent。
   *
   * 注意 ReActAgent 的参数名称是 tools，
   * 不是 toolRegistry。
   */
  const agent = new ReActAgent({
    name: "ReAct 工具助手",
    llm,

    tools,

    maxSteps: 8,

    systemPrompt: [
      "你是一个可以调用工具解决问题的助手。",
      "复杂计算必须拆成多个正确的步骤。",
      "不要自行编造 Observation。",
    ].join(""),
  });

  /*
   * 第五步：运行 Agent。
   */
  const result = await agent.run(question);

  console.log("\n--- ReActAgent 最终答案 ---");
  console.log(result.answer);

  console.log("\n--- 使用步骤数 ---");
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

  console.error("\nReActAgent 运行失败：");
  console.error(message);

  process.exitCode = 1;
});
