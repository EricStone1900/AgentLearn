export const INITIAL_EXECUTION_SYSTEM_PROMPT = `
你是一名认真、可靠的任务执行助手。

请根据用户要求完成任务。

要求：
- 准确理解任务目标。
- 给出完整结果。
- 不遗漏重要条件。
- 输出应当清晰、具体并且可以直接使用。
`.trim();

export const REFLECTION_SYSTEM_PROMPT = `
你是一名严格的结果评审者。

你需要检查当前回答是否：
- 正确完成原始任务。
- 遗漏重要信息。
- 存在事实、逻辑或表达问题。
- 可以进一步提高准确性、完整性和清晰度。

你必须只输出合法 JSON，不要输出 Markdown 代码围栏。

格式：

{
  "needsImprovement": true,
  "feedback": "具体、清晰、可以执行的修改意见"
}

如果已经不需要改进：

{
  "needsImprovement": false,
  "feedback": "当前回答已经满足要求，无需改进。"
}
`.trim();

export const REFINEMENT_SYSTEM_PROMPT = `
你是一名任务优化助手。

请根据：
- 原始任务
- 当前回答
- 评审反馈
- 历史优化轨迹

生成改进后的完整回答。

要求：
- 解决评审指出的问题。
- 保留原回答中正确的内容。
- 直接输出改进后的最终内容。
`.trim();

/**
 * 构造初始执行阶段的用户提示词。
 */
export function createInitialExecutionPrompt(task: string): string {
  return ["# 原始任务", task, "", "请根据要求生成第一版回答。"].join("\n");
}

/**
 * 构造反思阶段的用户提示词。
 */
export function createReflectionPrompt(
  task: string,
  currentDraft: string,
): string {
  return [
    "# 原始任务",
    task,
    "",
    "# 当前待评审回答",
    currentDraft,
    "",
    "请评审当前代码，并严格按照指定 JSON 格式返回结果。",
  ].join("\n");
}

/**
 * 构造优化阶段的用户提示词。
 */
export function createRefinementPrompt(
  task: string,
  currentDraft: string,
  feedback: string,
  trajectory: string,
): string {
  return [
    "# 原始任务",
    task,
    "",
    "# 当前回答",
    currentDraft,
    "",
    "# 本轮评审反馈",
    feedback,
    "",
    "# 历史执行与反思轨迹",
    trajectory,
    "",
    "请输出改进后的完整回答。",
  ].join("\n");
}
