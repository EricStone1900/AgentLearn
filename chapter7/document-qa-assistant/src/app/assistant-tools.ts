import type {
  MemoryManager,
  MemoryType,
} from "@ericstone/agent-patterns-ts/memory";
import type { RagService } from "@ericstone/agent-patterns-ts/rag";
import { ToolRegistry } from "@ericstone/agent-patterns-ts/tools";
import { z } from "zod";

export type AssistantToolRagService = Pick<RagService, "search">;

export type AssistantToolMemoryService = Pick<
  MemoryManager,
  "retrieveMemories"
>;

export interface CreateAssistantToolRegistryOptions {
  namespace: string;
  ragService: AssistantToolRagService;
  memoryManager: AssistantToolMemoryService;
}

const memoryTypeSchema = z.enum([
  "working",
  "episodic",
  "semantic",
  "perceptual",
]);

const knowledgeSearchInputSchema = z
  .object({
    query: z.string().trim().min(1).max(2_000),

    limit: z.number().int().min(1).max(10).default(5),

    minScore: z.number().min(-1).max(1).optional(),

    enableMqe: z.boolean().default(true),

    enableHyde: z.boolean().default(true),
  })
  .strict();

const memorySearchInputSchema = z
  .object({
    query: z.string().trim().min(1).max(2_000),

    memoryTypes: z.array(memoryTypeSchema).min(1).optional(),

    limit: z.number().int().min(1).max(20).default(5),

    minImportance: z.number().min(0).max(1).optional(),
  })
  .strict();

function normalizeNamespace(namespace: string): string {
  const normalized = namespace.trim();

  if (!normalized) {
    throw new Error("Agent 工具 namespace 不能为空");
  }

  return normalized;
}

export function createAssistantToolRegistry(
  options: CreateAssistantToolRegistryOptions,
): ToolRegistry {
  const namespace = normalizeNamespace(options.namespace);

  const registry = new ToolRegistry();

  registry.registerFunction({
    name: "knowledge_search",

    description: [
      "只读搜索当前用户的文档知识库。",
      "回答 PDF、文档、论文、手册和知识库相关问题时使用。",
      "工具会自动限制在当前用户的 namespace，不能添加或删除文档。",
    ].join(""),

    inputSchema: knowledgeSearchInputSchema,

    async handler(input): Promise<string> {
      const results = await options.ragService.search(input.query, {
        namespace,

        limit: input.limit,

        enableMqe: input.enableMqe,

        enableHyde: input.enableHyde,

        ...(input.minScore === undefined
          ? {}
          : {
              minScore: input.minScore,
            }),
      });

      return JSON.stringify(
        {
          success: true,

          count: results.length,

          results: results.map((result) => {
            return {
              documentId: result.document.id,

              chunkId: result.chunk.id,

              title: result.document.title,

              source: result.document.source,

              content: result.chunk.content,

              score: result.score,

              ...(result.chunk.headingPath
                ? {
                    headingPath: result.chunk.headingPath,
                  }
                : {}),

              startOffset: result.chunk.startOffset,

              endOffset: result.chunk.endOffset,
            };
          }),
        },
        null,
        2,
      );
    },
  });

  registry.registerFunction({
    name: "memory_search",

    description: [
      "只读搜索当前用户的历史记忆。",
      "涉及用户过去的问题、学习笔记、偏好和学习进度时使用。",
      "不能通过该工具添加、修改、删除或清空记忆。",
    ].join(""),

    inputSchema: memorySearchInputSchema,

    async handler(input): Promise<string> {
      const memoryTypes: MemoryType[] | undefined = input.memoryTypes;

      const results = await options.memoryManager.retrieveMemories({
        query: input.query,

        limit: input.limit,

        ...(memoryTypes
          ? {
              memoryTypes,
            }
          : {}),

        ...(input.minImportance === undefined
          ? {}
          : {
              minImportance: input.minImportance,
            }),
      });

      return JSON.stringify(
        {
          success: true,

          count: results.length,

          results: results.map((result) => {
            return {
              memoryId: result.item.id,

              content: result.item.content,

              memoryType: result.item.memoryType,

              importance: result.item.importance,

              timestamp: result.item.timestamp,

              score: result.score,

              metadata: result.item.metadata,
            };
          }),
        },
        null,
        2,
      );
    },
  });

  return registry;
}
