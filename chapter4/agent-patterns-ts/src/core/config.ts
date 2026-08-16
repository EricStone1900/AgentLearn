import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  LLM_API_KEY: z.string().min(1),
  LLM_MODEL_ID: z.string().min(1),
  LLM_BASE_URL: z.string().url().optional(),
  LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
  SERPAPI_API_KEY: z.string().min(1).optional(),
});

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(): AppConfig {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    throw new Error(
      `环境变量配置错误：\n${z.prettifyError(result.error)}\n请复制 .env.example 为 .env 后填写。`,
    );
  }
  return result.data;
}
