import { z } from "zod";

const appConfigSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),

  HOST: z.string().trim().min(1).default("127.0.0.1"),

  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),

  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
});

export type AppConfig = z.infer<typeof appConfigSchema>;

export function loadAppConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = appConfigSchema.safeParse(env);

  if (!result.success) {
    throw new Error(
      ["应用环境变量配置不正确：", z.prettifyError(result.error)].join("\n"),
    );
  }

  return result.data;
}
