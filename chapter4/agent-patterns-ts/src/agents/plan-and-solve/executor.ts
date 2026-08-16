import type { LlmClient } from "../../core/types.js";
import { createExecutorUserPrompt, EXECUTOR_SYSTEM_PROMPT } from "./prompts.js";
import type { ExecutionResult, StepRecord } from "./types.js";

export class Executor {
  public constructor(private readonly llm: LlmClient) {}

  public async execute(
    question: string,
    plan: string[],
  ): Promise<ExecutionResult> {
    const normalizedQuestion = question.trim();

    if (!normalizedQuestion) {
      throw new Error("执行问题不能为空");
    }

    if (plan.length === 0) {
      throw new Error("执行计划不能为空");
    }

    const history: StepRecord[] = [];

    console.log("\n--- 正在执行计划 ---");

    for (let index = 0; index < plan.length; index += 1) {
      const currentStep = plan[index];

      if (currentStep === undefined) {
        throw new Error(`无法读取计划中的第 ${index + 1} 步`);
      }

      const currentStepNumber = index + 1;

      console.log(
        [
          "",
          `-> 正在执行步骤`,
          `${currentStepNumber}/${plan.length}:`,
          currentStep,
        ].join(" "),
      );

      const result = await this.llm.generate(
        [
          {
            role: "system",
            content: EXECUTOR_SYSTEM_PROMPT,
          },
          {
            role: "user",
            content: createExecutorUserPrompt(
              normalizedQuestion,
              plan,
              history,
              currentStep,
              currentStepNumber,
            ),
          },
        ],
        0,
      );

      const normalizedResult = result.trim();

      if (!normalizedResult) {
        throw new Error(`步骤 ${currentStepNumber} 返回了空结果`);
      }

      const record: StepRecord = {
        stepNumber: currentStepNumber,
        step: currentStep,
        result: normalizedResult,
      };

      history.push(record);

      console.log(
        `✅ 步骤 ${currentStepNumber} 已完成，结果: ${normalizedResult}`,
      );
    }

    const lastRecord = history[history.length - 1];

    if (!lastRecord) {
      throw new Error("执行完成后没有任何结果");
    }

    return {
      finalAnswer: lastRecord.result,
      history,
    };
  }
}
