// import type { AgentResult, LlmClient, MessageData } from "../../core/types.js";
import { Agent, type AgentOptions } from "../../core/agent.js";
import { Message } from "../../core/message.js";
import type { AgentResult, MessageData } from "../../core/types.js";

import { parseJson } from "../../core/json.js";
import { ShortTermMemory } from "./memory.js";
import {
  createInitialExecutionPrompt,
  createReflectionPrompt,
  createRefinementPrompt,
  INITIAL_EXECUTION_SYSTEM_PROMPT,
  REFLECTION_SYSTEM_PROMPT,
  REFINEMENT_SYSTEM_PROMPT,
} from "./prompts.js";
import { reflectionDecisionSchema, type ReflectionDecision } from "./types.js";

export interface ReflectionAgentOptions extends AgentOptions {
  /**
   * 最多进行多少轮“反思”。
   */
  maxIterations?: number;
}

export class ReflectionAgent extends Agent {
  private readonly maxIterations: number;

  public constructor(options: ReflectionAgentOptions) {
    super(options);

    const maxIterations = options.maxIterations ?? 2;

    if (!Number.isInteger(maxIterations) || maxIterations < 1) {
      throw new Error("maxIterations 必须是大于等于 1 的整数");
    }

    this.maxIterations = maxIterations;
  }

  public async run(task: string): Promise<AgentResult> {
    const normalizedTask = task.trim();

    if (!normalizedTask) {
      throw new Error("Reflection 任务不能为空");
    }

    /*
     * 每次 run 都创建新的记忆。
     *
     * 这样同一个 Agent 实例连续执行两个任务时，
     * 第二个任务不会读到第一个任务的历史记录。
     */
    const memory = new ShortTermMemory();

    console.log("\n--- 开始 Reflection 任务 ---");
    console.log(`任务：${normalizedTask}`);

    /*
     * 第一阶段：生成初稿。
     */
    console.log("\n--- 正在生成初稿 ---");

    const initialDraft = await this.requestText(
      [
        {
          role: "system",
          content: INITIAL_EXECUTION_SYSTEM_PROMPT,
        },
        {
          role: "user",
          content: createInitialExecutionPrompt(normalizedTask),
        },
      ],
      0.2,
      "初始执行",
    );

    memory.add({
      kind: "execution",
      content: initialDraft,
    });

    let completedReflectionRounds = 0;

    /*
     * 第二阶段：反思与优化循环。
     */
    for (let iteration = 0; iteration < this.maxIterations; iteration += 1) {
      const roundNumber = iteration + 1;

      console.log(`\n--- 第 ${roundNumber}/${this.maxIterations} 轮反思 ---`);

      const currentDraft = memory.latestExecution();

      if (!currentDraft) {
        throw new Error("无法找到需要评审的执行结果");
      }

      /*
       * 调用评审模型。
       */
      const rawReflection = await this.requestText(
        [
          {
            role: "system",
            content: REFLECTION_SYSTEM_PROMPT,
          },
          {
            role: "user",
            content: createReflectionPrompt(normalizedTask, currentDraft),
          },
        ],
        0,
        `第 ${roundNumber} 轮反思`,
      );

      let decision: ReflectionDecision;

      try {
        decision = parseJson(rawReflection, reflectionDecisionSchema);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);

        throw new Error(`第 ${roundNumber} 轮反思结果解析失败：${message}`);
      }

      completedReflectionRounds = roundNumber;

      memory.add({
        kind: "reflection",
        content: JSON.stringify(decision, null, 2),
      });

      console.log(`评审意见：${decision.feedback}`);

      /*
       * 如果评审认为不需要改进，立即停止循环。
       */
      if (!decision.needsImprovement) {
        console.log("\n✅ 当前结果已通过评审。");
        break;
      }

      /*
       * 第三阶段：根据评审意见优化。
       */
      console.log("\n--- 正在根据反馈优化 ---");

      const refinedDraft = await this.requestText(
        [
          {
            role: "system",
            content: REFINEMENT_SYSTEM_PROMPT,
          },
          {
            role: "user",
            content: createRefinementPrompt(
              normalizedTask,
              currentDraft,
              decision.feedback,
              memory.trajectory(),
            ),
          },
        ],
        0.2,
        `第 ${roundNumber} 轮优化`,
      );

      memory.add({
        kind: "execution",
        content: refinedDraft,
      });
    }

    const finalDraft = memory.latestExecution();

    if (!finalDraft) {
      throw new Error("Reflection 任务没有生成最终结果");
    }
    this.addMessage(new Message(normalizedTask, "user"));
    this.addMessage(new Message(finalDraft, "assistant"));

    return {
      answer: finalDraft,
      /*
       * 这里的 steps 表示实际完成的反思轮数。
       */
      steps: completedReflectionRounds,
    };
  }

  /**
   * 统一调用 LLM，并拒绝空响应。
   */
  private async requestText(
    messages: MessageData[],
    temperature: number,
    stageName: string,
  ): Promise<string> {
    const response = await this.llm.generate(messages, temperature);

    const normalizedResponse = response.trim();

    if (!normalizedResponse) {
      throw new Error(`${stageName}阶段的模型响应为空`);
    }

    return normalizedResponse;
  }
}
