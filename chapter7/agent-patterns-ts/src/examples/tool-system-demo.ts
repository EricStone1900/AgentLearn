import "dotenv/config";

import { HelloAgentsLlm } from "../core/hello-agents-llm.js";

import { FunctionCallAgent } from "../agents/function-call/function-call-agent.js";

import { advancedCalculatorTool } from "../tools/advanced-calculator.js";

import { createHybridSearchToolFromEnv } from "../tools/search/hybrid-search.js";

import { ToolRegistry } from "../tools/tool.js";

async function main(): Promise<void> {
  const llm = new HelloAgentsLlm();

  const tools = new ToolRegistry();

  tools.register(advancedCalculatorTool);

  if (process.env.TAVILY_API_KEY || process.env.SERPAPI_API_KEY) {
    tools.register(createHybridSearchToolFromEnv());
  }

  console.log("--- 可用工具 ---");
  console.log(tools.describeWithSchemas());

  const agent = new FunctionCallAgent({
    name: "工具系统助手",
    llm,
    toolRegistry: tools,
    maxToolIterations: 5,
  });

  const result = await agent.run("请计算 sqrt(16) + 2 * 3，并说明计算步骤。");

  console.log("\n--- 最终答案 ---");
  console.log(result.answer);

  console.log("\n--- LLM 调用次数 ---");
  console.log(result.steps);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);

  console.error("工具系统示例执行失败：");
  console.error(message);

  process.exitCode = 1;
});
