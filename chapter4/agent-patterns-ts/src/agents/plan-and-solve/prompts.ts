import type { StepRecord } from "./types.js";

/**
 * Planner 的系统提示词。
 *
 * Planner 的唯一职责是拆解任务，
 * 不负责真正执行步骤。
 */
export const PLANNER_SYSTEM_PROMPT = `
你是一名专业的任务规划专家。

你的任务是把用户提出的复杂问题拆解成多个简单、明确、可以依次执行的步骤。

要求：
- 每个步骤必须是独立且可以执行的子任务。
- 步骤之间必须按照正确的逻辑顺序排列。
- 后面的步骤可以依赖前面步骤的结果。
- 不要跳过完成最终问题所需的关键步骤。
- 不要输出解释文字。
- 不要输出 Markdown 代码围栏。
- 只输出一个合法 JSON 对象。

输出格式必须是：
{
  "steps": [
    "步骤1",
    "步骤2",
    "步骤3"
  ]
}
`.trim();

/**
 * 为 Planner 构造用户消息。
 */
export function createPlannerUserPrompt(question: string): string {
  return ["请为下面的问题制定行动计划：", "", question].join("\n");
}

/**
 * Executor 的系统提示词。
 *
 * Executor 不再规划任务，
 * 它只负责完成当前这一个步骤。
 */
export const EXECUTOR_SYSTEM_PROMPT = `
你是一名专业的任务执行专家。

你将收到：
- 原始问题
- 完整计划
- 当前步骤
- 此前已经完成的步骤和结果

要求：
- 只完成“当前步骤”。
- 必须使用此前步骤已经得到的结果。
- 不要跳到后面的步骤。
- 不要重新制定计划。
- 不要与用户对话。
- 只输出当前步骤的最终结果。
`.trim();

/**
 * 把计划格式化成便于模型阅读的编号列表。
 */
export function formatPlan(plan: string[]): string {
  return plan.map((step, index) => `${index + 1}. ${step}`).join("\n");
}

/**
 * 把历史记录格式化成文本。
 */
export function formatHistory(history: StepRecord[]): string {
  if (history.length === 0) {
    return "无";
  }

  return history
    .map((record) => {
      return [
        `步骤 ${record.stepNumber}: ${record.step}`,
        `结果: ${record.result}`,
      ].join("\n");
    })
    .join("\n\n");
}

/**
 * 为 Executor 构造当前步骤的用户提示词。
 */
export function createExecutorUserPrompt(
  question: string,
  plan: string[],
  history: StepRecord[],
  currentStep: string,
  currentStepNumber: number,
): string {
  return [
    "# 原始问题",
    question,
    "",
    "# 完整计划",
    formatPlan(plan),
    "",
    "# 历史步骤与结果",
    formatHistory(history),
    "",
    "# 当前步骤",
    `步骤 ${currentStepNumber}: ${currentStep}`,
    "",
    "请只输出当前步骤的最终结果。",
  ].join("\n");
}
