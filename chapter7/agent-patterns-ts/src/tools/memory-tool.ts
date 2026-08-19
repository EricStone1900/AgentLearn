import { z } from "zod";
import type { MemoryManager } from "../memory/manager.js";
import {
  forgetStrategySchema,
  memoryTypeSchema,
} from "../memory/schemas.js";
import type { Tool } from "./tool.js";

const memoryToolInputSchema = z
  .object({
    action: z.enum([
      "add",
      "search",
      "update",
      "remove",
      "summary",
      "stats",
      "forget",
      "consolidate",
      "clear",
    ]),
    content: z.string().optional(),
    query: z.string().optional(),
    memoryId: z.string().optional(),
    memoryType: memoryTypeSchema.optional(),
    memoryTypes: z.array(memoryTypeSchema).optional(),
    importance: z.number().min(0).max(1).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    limit: z.number().int().positive().max(100).optional(),
    strategy: forgetStrategySchema.optional(),
    threshold: z.number().min(0).max(1).optional(),
    maxAgeDays: z.number().positive().optional(),
    fromType: memoryTypeSchema.optional(),
    toType: memoryTypeSchema.optional(),
    importanceThreshold: z.number().min(0).max(1).optional(),
    confirm: z.boolean().optional(),
  })
  .superRefine((input, context) => {
    if (input.action === "add" && !input.content?.trim()) {
      context.addIssue({ code: "custom", message: "add 操作需要 content" });
    }
    if (input.action === "search" && !input.query?.trim()) {
      context.addIssue({ code: "custom", message: "search 操作需要 query" });
    }
    if (["update", "remove"].includes(input.action) && !input.memoryId) {
      context.addIssue({ code: "custom", message: `${input.action} 操作需要 memoryId` });
    }
    if (input.action === "clear" && input.confirm !== true) {
      context.addIssue({ code: "custom", message: "clear 操作需要 confirm=true" });
    }
  });

type MemoryToolInput = z.infer<typeof memoryToolInputSchema>;

function asJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export function createMemoryTool(
  manager: MemoryManager,
): Tool<MemoryToolInput> {
  return {
    name: "memory",
    description: [
      "管理当前用户的工作、情景、语义和感知记忆。",
      "支持添加、搜索、更新、删除、摘要、统计、遗忘、整合和清空。",
      "涉及用户历史和偏好时先搜索；只有明确需要长期保存时才添加。",
    ].join(""),
    inputSchema: memoryToolInputSchema,

    async execute(input): Promise<string> {
      switch (input.action) {
        case "add": {
          const memoryId = await manager.addMemory({
            content: input.content ?? "",
            ...(input.memoryType ? { memoryType: input.memoryType } : {}),
            ...(input.importance === undefined
              ? {}
              : { importance: input.importance }),
            ...(input.metadata ? { metadata: input.metadata } : {}),
          });
          return asJson({ success: true, memoryId });
        }

        case "search": {
          const results = await manager.retrieveMemories({
            query: input.query ?? "",
            ...(input.memoryTypes ? { memoryTypes: input.memoryTypes } : {}),
            ...(input.limit === undefined ? {} : { limit: input.limit }),
          });
          return asJson({
            success: true,
            count: results.length,
            results,
          });
        }

        case "update": {
          const updated = await manager.updateMemory(input.memoryId ?? "", {
            ...(input.content === undefined ? {} : { content: input.content }),
            ...(input.importance === undefined
              ? {}
              : { importance: input.importance }),
            ...(input.metadata ? { metadata: input.metadata } : {}),
          });
          return asJson({ success: updated });
        }

        case "remove": {
          const removed = await manager.removeMemory(input.memoryId ?? "");
          return asJson({ success: removed });
        }

        case "summary": {
          const memories = await manager.getSummary(input.limit ?? 10);
          return asJson({ success: true, memories });
        }

        case "stats": {
          return asJson({ success: true, stats: await manager.getStats() });
        }

        case "forget": {
          const count = await manager.forgetMemories({
            strategy: input.strategy ?? "importance_based",
            ...(input.threshold === undefined
              ? {}
              : { threshold: input.threshold }),
            ...(input.maxAgeDays === undefined
              ? {}
              : { maxAgeDays: input.maxAgeDays }),
          });
          return asJson({ success: true, forgottenCount: count });
        }

        case "consolidate": {
          const count = await manager.consolidateMemories({
            fromType: input.fromType ?? "working",
            toType: input.toType ?? "episodic",
            importanceThreshold: input.importanceThreshold ?? 0.7,
          });
          return asJson({ success: true, consolidatedCount: count });
        }

        case "clear": {
          // Schema 已要求 confirm=true，这里仍保留防御性检查。
          if (input.confirm !== true) throw new Error("清空记忆需要 confirm=true");
          await manager.clearAllMemories();
          return asJson({ success: true });
        }
      }
    },
  };
}