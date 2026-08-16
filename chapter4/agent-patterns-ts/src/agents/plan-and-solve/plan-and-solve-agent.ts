import type { AgentResult, LlmClient } from "../../core/types.js";
import { Executor } from "./executor.js";
import { Planner } from "./planner.js";

export class PlanAndSolveAgent {
  private readonly planner: Planner;
  private readonly executor: Executor;

  public constructor(llm: LlmClient) {
    this.planner = new Planner(llm);
    this.executor = new Executor(llm);
  }

  public async run(question: string): Promise<AgentResult> {
    const normalizedQuestion = question.trim();

    if (!normalizedQuestion) {
      throw new Error("Plan-and-Solve 问题不能为空");
    }

    console.log("\n--- 开始处理问题 ---");
    console.log(`问题: ${normalizedQuestion}`);

    /*
     * 第一阶段：规划
     */
    const plan = await this.planner.plan(normalizedQuestion);

    /*
     * 第二阶段：执行
     */
    const execution = await this.executor.execute(normalizedQuestion, plan);

    console.log("\n--- 任务完成 ---");
    console.log(`最终答案: ${execution.finalAnswer}`);

    return {
      answer: execution.finalAnswer,
      steps: plan.length,
    };
  }
}
