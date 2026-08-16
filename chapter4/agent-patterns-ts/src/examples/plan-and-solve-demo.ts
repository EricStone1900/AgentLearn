import { PlanAndSolveAgent } from "../agents/plan-and-solve/plan-and-solve-agent.js";
import { loadConfig } from "../core/config.js";
import { OpenAiLlmClient } from "../core/openai-llm.js";

async function main(): Promise<void> {
  const config = loadConfig();

  const llm = new OpenAiLlmClient(config);

  const commandLineQuestion = process.argv.slice(2).join(" ").trim();

  const defaultQuestion = [
    "一个水果店周一卖出了15个苹果。",
    "周二卖出的苹果数量是周一的两倍。",
    "周三卖出的数量比周二少了5个。",
    "请问这三天总共卖出了多少个苹果？",
  ].join("");

  const question = commandLineQuestion || defaultQuestion;

  const agent = new PlanAndSolveAgent(llm);

  const result = await agent.run(question);

  console.log("\n--- 运行结果 ---");
  console.log(`答案: ${result.answer}`);
  console.log(`计划步骤数: ${result.steps}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);

  console.error("\nPlan-and-Solve 运行失败：");

  console.error(message);

  process.exitCode = 1;
});
