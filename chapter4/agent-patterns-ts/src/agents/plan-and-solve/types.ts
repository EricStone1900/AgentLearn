import { z } from "zod";

/**
 * Planner 必须生成的 JSON 结构。
 *
 * 示例：
 * {
 *   "steps": [
 *     "计算周二卖出的苹果数量",
 *     "计算周三卖出的苹果数量",
 *     "计算三天总销量"
 *   ]
 * }
 */
export const planSchema = z.object({
  steps: z.array(z.string().trim().min(1)).min(1).max(12),
});

/**
 * 根据 planSchema 自动推导出来的类型。
 */
export type PlanOutput = z.infer<typeof planSchema>;

/**
 * 执行器完成一个步骤后保存的记录。
 */
export interface StepRecord {
  stepNumber: number;
  step: string;
  result: string;
}

/**
 * Executor 执行完整计划后的返回结果。
 */
export interface ExecutionResult {
  finalAnswer: string;
  history: StepRecord[];
}
