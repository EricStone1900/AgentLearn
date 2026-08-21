import { z } from "zod";

const optionalString = z.preprocess(
  (value) => typeof value === "string" && !value.trim() ? undefined : value,
  z.string().min(1).optional(),
);

const schema = z.object({
  RAG_SQLITE_PATH: z.string().trim().min(1),
  RAG_KNOWLEDGE_ROOT: z.string().trim().min(1),
  RAG_QDRANT_COLLECTION: z.string().trim().min(1).default("rag_knowledge_v1"),
  RAG_CHUNK_TOKENS: z.coerce.number().int().positive().default(800),
  RAG_CHUNK_OVERLAP_TOKENS: z.coerce.number().int().nonnegative().default(100),
  EMBEDDING_API_KEY: z.string().trim().min(1),
  EMBEDDING_BASE_URL: z.string().url(),
  EMBEDDING_MODEL: z.string().trim().min(1),
  EMBEDDING_DIMENSION: z.coerce.number().int().positive(),
  EMBEDDING_SEND_DIMENSIONS: z.enum(["true", "false"]).transform((v) => v === "true"),
  QDRANT_URL: z.string().url(),
  QDRANT_API_KEY: optionalString,
}).superRefine((value, context) => {
  if (value.RAG_CHUNK_OVERLAP_TOKENS >= value.RAG_CHUNK_TOKENS) {
    context.addIssue({
      code: "custom",
      path: ["RAG_CHUNK_OVERLAP_TOKENS"],
      message: "必须小于 RAG_CHUNK_TOKENS",
    });
  }
});

export type ProductionRagConfig = z.infer<typeof schema>;

export function loadProductionRagConfig(
  env: NodeJS.ProcessEnv = process.env,
): ProductionRagConfig {
  const result = schema.safeParse(env);
  if (!result.success) {
    throw new Error(`RAG 环境变量不完整：\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}