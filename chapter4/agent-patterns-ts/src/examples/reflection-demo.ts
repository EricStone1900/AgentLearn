import { ReflectionAgent } from "../agents/reflection/reflection-agent.js";
import { loadConfig } from "../core/config.js";
import { OpenAiLlmClient } from "../core/openai-llm.js";

async function main(): Promise<void> {
  const config = loadConfig();

  const llm = new OpenAiLlmClient(config);

  /*
   * 读取 npm 命令后面传入的任务。
   */
  const commandLineTask = process.argv.slice(2).join(" ").trim();

  const defaultTask = [
    "编写一个 Python 函数，",
    "找出 1 到 n 之间所有的素数。",
    "要求考虑算法效率和边界情况。",
  ].join("");

  const task = commandLineTask || defaultTask;

  const agent = new ReflectionAgent(llm, {
    maxIterations: 2,
  });

  const result = await agent.run(task);

  console.log("\n--- Reflection 最终结果 ---");
  console.log(result.answer);

  console.log(`\n实际完成的反思轮数：${result.steps}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);

  console.error("\nReflection 运行失败：");
  console.error(message);

  process.exitCode = 1;
});
