import { z } from "zod";

/**
 * 约束“评审模型”必须返回的 JSON 格式。
 */
export const reflectionDecisionSchema = z
  .object({
    /**
     * true：当前代码还需要继续修改。
     * false：当前代码已经满足要求，可以停止。
     */
    needsImprovement: z.boolean(),

    /**
     * 具体的评审意见。
     */
    feedback: z.string().trim().min(1),
  })
  .strict();

/**
 * 从 Zod Schema 自动推导 TypeScript 类型。
 */
export type ReflectionDecision = z.infer<typeof reflectionDecisionSchema>;
