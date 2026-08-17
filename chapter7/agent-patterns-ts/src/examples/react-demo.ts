import { ReActAgent } from "../agents/react/react-agent.js";
import { loadConfig } from "../core/config.js";
import { OpenAiLlmClient } from "../core/openai-llm.js";
import { calculatorTool } from "../tools/calculator.js";
import { createSearchTool } from "../tools/search.js";
import { ToolRegistry } from "../tools/tool.js";

async function main(): Promise<void> {
  const config = loadConfig();

  const llm = new OpenAiLlmClient(config);

  const tools = new ToolRegistry();

  tools.register(calculatorTool);

  if (config.SERPAPI_API_KEY) {
    tools.register(createSearchTool(config.SERPAPI_API_KEY));
  }

  const commandLineQuestion = process.argv.slice(2).join(" ").trim();

  const question = commandLineQuestion || "计算 (123 + 456) × 789 ÷ 12";

  console.log("\n--- 可用工具 ---");
  console.log(tools.describe());

  console.log("\n--- 用户问题 ---");
  console.log(question);

  const agent = new ReActAgent({
    name: "ReAct 助手",
    llm,
    tools,
    maxSteps: 8,
  });

  const result = await agent.run(question);

  console.log("\n--- 最终答案 ---");
  console.log(result.answer);

  console.log("\n--- 使用步骤数 ---");
  console.log(result.steps);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);

  console.error("\nReAct 运行失败：");
  console.error(message);

  process.exitCode = 1;
});
