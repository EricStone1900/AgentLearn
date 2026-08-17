// import type { AgentResult, LlmClient } from "../../core/types.js";、
import { Agent, type AgentOptions } from "../../core/agent.js";
import { Message } from "../../core/message.js";
import type { AgentResult } from "../../core/types.js";
import { Executor } from "./executor.js";
import { Planner } from "./planner.js";

export class PlanAndSolveAgent extends Agent {
  private readonly planner: Planner;
  private readonly executor: Executor;

  public constructor(options: AgentOptions) {
    super(options);

    this.planner = new Planner(this.llm);
    this.executor = new Executor(this.llm);
  }

  public async run(question: string): Promise<AgentResult> {
    const normalizedQuestion = question.trim();

    if (!normalizedQuestion) {
      throw new Error("Plan-and-Solve 问题不能为空");
    }

    /*
     * 第一阶段：生成结构化计划。
     */
    const plan = await this.planner.plan(normalizedQuestion);

    /*
     * 第二阶段：顺序执行每一个步骤。
     */
    const execution = await this.executor.execute(normalizedQuestion, plan);

    this.addMessage(new Message(normalizedQuestion, "user"));

    this.addMessage(
      new Message(execution.finalAnswer, "assistant", {
        metadata: {
          plan,
          executionHistory: execution.history,
        },
      }),
    );

    return {
      answer: execution.finalAnswer,
      steps: plan.length,
    };
  }
}
