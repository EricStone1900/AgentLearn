import { z } from "zod";

const optionalNonEmptyString = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  const normalized = value.trim();
  return normalized === "" ? undefined : normalized;
}, z.string().min(1).optional());

const productionMemoryEnvSchema = z.object({
  MEMORY_SQLITE_PATH: z.string().trim().min(1),
  MEMORY_OUTBOX_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),

  EMBEDDING_API_KEY: z.string().trim().min(1),
  EMBEDDING_BASE_URL: z
    .string()
    .url()
    .default("https://api.siliconflow.com/v1"),
  EMBEDDING_MODEL: z
    .string()
    .trim()
    .min(1)
    .default("Qwen/Qwen3-Embedding-0.6B"),
  EMBEDDING_DIMENSION: z.coerce.number().int().positive().default(1024),
  EMBEDDING_SEND_DIMENSIONS: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .default(true),

  QDRANT_URL: z.string().url(),
  QDRANT_API_KEY: optionalNonEmptyString,
  QDRANT_COLLECTION: z.string().trim().min(1).default("agent_memories_v1"),

  NEO4J_URI: z.string().trim().min(1),
  NEO4J_USERNAME: z.string().trim().min(1),
  NEO4J_PASSWORD: z.string().min(1),
  NEO4J_DATABASE: z.string().trim().min(1).default("neo4j"),
});

export type ProductionMemoryConfig = z.infer<typeof productionMemoryEnvSchema>;

export function loadProductionMemoryConfig(
  env: NodeJS.ProcessEnv = process.env,
): ProductionMemoryConfig {
  const result = productionMemoryEnvSchema.safeParse(env);

  if (!result.success) {
    throw new Error(
      ["第二阶段记忆系统环境变量不完整：", z.prettifyError(result.error)].join(
        "\n",
      ),
    );
  }

  return result.data;
}
