import { z } from "zod";
import type { RagService } from "../rag/rag-service.js";
import type { Tool } from "./tool.js";

export type RagToolService = Pick<
  RagService,
  "ingestText" | "ingestFile" | "search" | "ask" | "deleteDocument" | "getStats"
>;

const ragToolInputSchema = z.object({
  action: z.enum(["add_text", "add_file", "search", "ask", "delete", "stats"]),
  namespace: z.string().trim().min(1).default("default"),
  text: z.string().optional(),
  source: z.string().optional(),
  filePath: z.string().optional(),
  documentId: z.string().optional(),
  query: z.string().optional(),
  limit: z.number().int().min(1).max(20).default(5),
  minScore: z.number().min(-1).max(1).optional(),
  enableMqe: z.boolean().default(false),
  enableHyde: z.boolean().default(false),
  maxContextCharacters: z.number().int().min(500).max(30_000).default(6_000),
}).superRefine((input, context) => {
  if (input.action === "add_text" && !input.text?.trim()) {
    context.addIssue({ code: "custom", path: ["text"], message: "add_text 需要 text" });
  }
  if (input.action === "add_file" && !input.filePath?.trim()) {
    context.addIssue({ code: "custom", path: ["filePath"], message: "add_file 需要 filePath" });
  }
  if (["search", "ask"].includes(input.action) && !input.query?.trim()) {
    context.addIssue({ code: "custom", path: ["query"], message: `${input.action} 需要 query` });
  }
  if (input.action === "delete" && !input.documentId?.trim()) {
    context.addIssue({ code: "custom", path: ["documentId"], message: "delete 需要 documentId" });
  }
});

type RagToolInput = z.infer<typeof ragToolInputSchema>;

export function createRagTool(service: RagToolService): Tool<RagToolInput> {
  return {
    name: "rag",
    description: [
      "管理和检索外部知识库。",
      "回答项目文档、手册和导入资料相关问题时使用 search 或 ask。",
      "add_file 只能读取配置的知识库根目录。",
    ].join(""),
    inputSchema: ragToolInputSchema,
    async execute(input): Promise<string> {
      switch (input.action) {
        case "add_text":
          return JSON.stringify(await service.ingestText(
            input.text ?? "",
            input.source?.trim() || `agent-text-${Date.now()}.md`,
            {
              namespace: input.namespace,
              ...(input.documentId ? { documentId: input.documentId } : {}),
            },
          ), null, 2);
        case "add_file":
          return JSON.stringify(await service.ingestFile(input.filePath ?? "", {
            namespace: input.namespace,
            ...(input.documentId ? { documentId: input.documentId } : {}),
          }), null, 2);
        case "search":
          return JSON.stringify({
            success: true,
            results: await service.search(input.query ?? "", {
              namespace: input.namespace,
              limit: input.limit,
              ...(input.minScore === undefined ? {} : { minScore: input.minScore }),
              enableMqe: input.enableMqe,
              enableHyde: input.enableHyde,
            }),
          }, null, 2);
        case "ask":
          return JSON.stringify(await service.ask(input.query ?? "", {
            namespace: input.namespace,
            limit: input.limit,
            ...(input.minScore === undefined ? {} : { minScore: input.minScore }),
            enableMqe: input.enableMqe,
            enableHyde: input.enableHyde,
            maxContextCharacters: input.maxContextCharacters,
          }), null, 2);
        case "delete":
          return JSON.stringify({
            success: await service.deleteDocument(input.documentId ?? ""),
          }, null, 2);
        case "stats":
          return JSON.stringify({
            success: true,
            stats: await service.getStats(input.namespace),
          }, null, 2);
      }
    },
  };
}