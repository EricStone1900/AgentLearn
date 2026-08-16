/**
 * 初始执行阶段使用的系统提示词。
 */
export const INITIAL_EXECUTION_SYSTEM_PROMPT = `
你是一名资深 Python 程序员。

你的任务是根据用户要求编写 Python 代码。

要求：
- 提供完整的函数签名。
- 提供清晰的文档字符串。
- 遵循 PEP 8 编码规范。
- 正确处理合理的边界情况。
- 只输出代码。
- 不要解释代码。
`.trim();

/**
 * 反思阶段使用的系统提示词。
 */
export const REFLECTION_SYSTEM_PROMPT = `
你是一名极其严格的代码评审专家和资深算法工程师。

你的任务是评审代码，而不是重新编写代码。

请重点检查：
- 功能是否正确。
- 是否遗漏边界情况。
- 时间复杂度是否合理。
- 空间复杂度是否合理。
- 是否存在重复计算。
- 是否有明显更优的算法。
- 代码是否满足原始任务要求。

你必须只输出一个合法 JSON 对象。
不要输出 Markdown 代码围栏。
不要输出 JSON 之外的解释。

输出格式：

{
  "needsImprovement": true,
  "feedback": "具体、清晰、可操作的改进建议"
}

如果代码已经满足原始要求，并且不存在值得修改的问题，请返回：

{
  "needsImprovement": false,
  "feedback": "当前代码已经满足要求，无需改进。"
}
`.trim();

/**
 * 优化阶段使用的系统提示词。
 */
export const REFINEMENT_SYSTEM_PROMPT = `
你是一名资深 Python 程序员。

你将收到：
- 原始任务
- 当前代码
- 评审反馈
- 此前的执行与反思轨迹

你的任务是根据评审反馈修改当前代码。

要求：
- 必须解决评审反馈指出的问题。
- 不要删除已经正确实现的功能。
- 保留完整的函数签名和文档字符串。
- 遵循 PEP 8 编码规范。
- 只输出优化后的完整代码。
- 不要输出解释。
`.trim();

/**
 * 构造初始执行阶段的用户提示词。
 */
export function createInitialExecutionPrompt(task: string): string {
  return ["# 原始任务", task, "", "请根据要求生成第一版代码。"].join("\n");
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
    "# 当前待评审代码",
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
    "# 当前代码",
    currentDraft,
    "",
    "# 本轮评审反馈",
    feedback,
    "",
    "# 历史执行与反思轨迹",
    trajectory,
    "",
    "请输出修改后的完整代码。",
  ].join("\n");
}
