import "dotenv/config";
import { z } from "zod";
import { supportedProviders, type LlmProvider } from "./llm-types.js";
import { ConfigError } from "./errors.js";

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

export const logLevels = ["DEBUG", "INFO", "WARN", "ERROR"] as const;

export type LogLevel = (typeof logLevels)[number];

export interface ConfigOptions {
  defaultModel?: string;
  defaultProvider?: LlmProvider;
  temperature?: number;
  maxTokens?: number;
  debug?: boolean;
  logLevel?: LogLevel;
  maxHistoryLength?: number;
}

export interface ConfigSnapshot {
  defaultModel: string;
  defaultProvider: LlmProvider;
  temperature: number;
  maxTokens: number | undefined;
  debug: boolean;
  logLevel: LogLevel;
  maxHistoryLength: number;
}

const configSchema = z.object({
  defaultModel: z.string().min(1).default("gpt-3.5-turbo"),

  defaultProvider: z.enum(supportedProviders).default("openai"),

  temperature: z.number().min(0).max(2).default(0.7),

  maxTokens: z.number().int().positive().optional(),

  debug: z.boolean().default(false),

  logLevel: z.enum(logLevels).default("INFO"),

  maxHistoryLength: z.number().int().positive().default(100),
});

function parseBooleanEnvironmentValue(
  value: string | undefined,
  name: string,
): boolean | undefined {
  if (value === undefined || value.trim() === "") {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();

  if (normalized === "true") {
    return true;
  }

  if (normalized === "false") {
    return false;
  }

  throw new ConfigError(`${name} 必须是 true 或 false`);
}

function parseNumberEnvironmentValue(
  value: string | undefined,
  name: string,
): number | undefined {
  if (value === undefined || value.trim() === "") {
    return undefined;
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    throw new ConfigError(`${name} 必须是有效数字`);
  }

  return parsed;
}

export class Config {
  public readonly defaultModel: string;
  public readonly defaultProvider: LlmProvider;
  public readonly temperature: number;
  public readonly maxTokens: number | undefined;
  public readonly debug: boolean;
  public readonly logLevel: LogLevel;
  public readonly maxHistoryLength: number;

  public constructor(options: ConfigOptions = {}) {
    const parsed = configSchema.parse(options);

    this.defaultModel = parsed.defaultModel;
    this.defaultProvider = parsed.defaultProvider;
    this.temperature = parsed.temperature;
    this.maxTokens = parsed.maxTokens;
    this.debug = parsed.debug;
    this.logLevel = parsed.logLevel;
    this.maxHistoryLength = parsed.maxHistoryLength;
  }

  public static fromEnv(env: NodeJS.ProcessEnv = process.env): Config {
    const rawConfig = {
      defaultModel: env.LLM_MODEL_ID,

      defaultProvider: env.LLM_PROVIDER,

      temperature: parseNumberEnvironmentValue(
        env.LLM_TEMPERATURE,
        "LLM_TEMPERATURE",
      ),

      maxTokens: parseNumberEnvironmentValue(
        env.LLM_MAX_TOKENS,
        "LLM_MAX_TOKENS",
      ),

      debug: parseBooleanEnvironmentValue(env.DEBUG, "DEBUG"),

      logLevel: env.LOG_LEVEL?.trim().toUpperCase(),

      maxHistoryLength: parseNumberEnvironmentValue(
        env.MAX_HISTORY_LENGTH,
        "MAX_HISTORY_LENGTH",
      ),
    };

    /*
     * Zod 会：
     * 1. 忽略 undefined 后应用默认值
     * 2. 验证 Provider
     * 3. 验证日志级别
     * 4. 验证数值范围
     */
    const parsed = configSchema.parse(rawConfig);

    return new Config({
      defaultModel: parsed.defaultModel,
      defaultProvider: parsed.defaultProvider,
      temperature: parsed.temperature,
      debug: parsed.debug,
      logLevel: parsed.logLevel,
      maxHistoryLength: parsed.maxHistoryLength,

      ...(parsed.maxTokens === undefined
        ? {}
        : {
            maxTokens: parsed.maxTokens,
          }),
    });
  }

  public toObject(): ConfigSnapshot {
    return {
      defaultModel: this.defaultModel,
      defaultProvider: this.defaultProvider,
      temperature: this.temperature,
      maxTokens: this.maxTokens,
      debug: this.debug,
      logLevel: this.logLevel,
      maxHistoryLength: this.maxHistoryLength,
    };
  }
}
