import { parseJson } from "../../core/json.js";
import type { LlmClient } from "../../core/types.js";
import { createPlannerUserPrompt, PLANNER_SYSTEM_PROMPT } from "./prompts.js";
import { planSchema } from "./types.js";

export class Planner {
  public constructor(private readonly llm: LlmClient) {}

  public async plan(question: string): Promise<string[]> {
    const normalizedQuestion = question.trim();

    if (!normalizedQuestion) {
      throw new Error("规划问题不能为空");
    }

    console.log("\n--- 正在生成计划 ---");

    const rawResponse = await this.llm.generate(
      [
        {
          role: "system",
          content: PLANNER_SYSTEM_PROMPT,
        },
        {
          role: "user",
          content: createPlannerUserPrompt(normalizedQuestion),
        },
      ],
      0,
    );

    console.log("\n--- Planner 原始输出 ---");
    console.log(rawResponse);

    try {
      const planOutput = parseJson(rawResponse, planSchema);

      console.log("\n--- 计划已生成 ---");

      planOutput.steps.forEach((step, index) => {
        console.log(`${index + 1}. ${step}`);
      });

      return planOutput.steps;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);

      throw new Error(
        [
          "无法解析 Planner 生成的计划。",
          `错误详情：${message}`,
          `原始输出：${rawResponse}`,
        ].join("\n"),
      );
    }
  }
}
