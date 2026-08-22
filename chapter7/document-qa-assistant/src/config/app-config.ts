import {
  isAbsolute,
  resolve,
} from "node:path";
import {
  dirname,
} from "node:path";
import {
  fileURLToPath,
} from "node:url";
import {
  supportedProviders,
  type LlmProvider,
} from "@ericstone/agent-patterns-ts/core";
import {
  loadProductionMemoryConfig,
  type ProductionMemoryConfig,
} from "@ericstone/agent-patterns-ts/memory";
import {
  loadProductionRagConfig,
  type ProductionRagConfig,
} from "@ericstone/agent-patterns-ts/rag";
import { z } from "zod";

const projectRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../..",
);

const appEnvironmentSchema = z.object({
  NODE_ENV: z
    .enum([
      "development",
      "test",
      "production",
    ])
    .default("development"),

  HOST: z
    .string()
    .trim()
    .min(1)
    .default("127.0.0.1"),

  PORT: z.coerce
    .number()
    .int()
    .min(1)
    .max(65_535)
    .default(3000),

  LOG_LEVEL: z
    .enum([
      "fatal",
      "error",
      "warn",
      "info",
      "debug",
      "trace",
      "silent",
    ])
    .default("info"),

    APP_DEFAULT_USER_ID: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(
        /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/u,
        "只能包含字母、数字、下划线和连字符",
    )
    .default("local-user"),

  RAG_NAMESPACE_PREFIX: z
    .string()
    .trim()
    .min(1)
    .regex(
      /^[a-z0-9][a-z0-9_-]*$/u,
      "只能包含小写字母、数字、下划线和连字符",
    )
    .default("document-qa"),

  UPLOAD_ROOT: z
    .string()
    .trim()
    .min(1)
    .default("./uploads"),

  REPORT_ROOT: z
    .string()
    .trim()
    .min(1)
    .default("./reports"),

  MAX_UPLOAD_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(25 * 1024 * 1024),

  MAX_PDF_PAGES: z.coerce
    .number()
    .int()
    .positive()
    .max(10_000)
    .default(300),

  MIN_PDF_TEXT_CHARACTERS: z.coerce
    .number()
    .int()
    .positive()
    .default(20),

  LLM_PROVIDER: z
    .enum(supportedProviders)
    .default("custom"),

  LLM_API_KEY: z
    .string()
    .trim()
    .min(1),

  LLM_BASE_URL: z
    .string()
    .url(),

  LLM_MODEL_ID: z
    .string()
    .trim()
    .min(1),

  LLM_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(60_000),

  LLM_TEMPERATURE: z.coerce
    .number()
    .min(0)
    .max(2)
    .default(0.2),

  LLM_MAX_TOKENS: z.coerce
    .number()
    .int()
    .positive()
    .default(2048),
});

type RawAppEnvironment =
  z.infer<typeof appEnvironmentSchema>;

export interface ServerConfig {
  nodeEnv: "development" | "test" | "production";
  host: string;
  port: number;
  logLevel:
    | "fatal"
    | "error"
    | "warn"
    | "info"
    | "debug"
    | "trace"
    | "silent";
}

export interface LlmRuntimeConfig {
  provider: LlmProvider;
  apiKey: string;
  baseURL: string;
  model: string;
  timeoutMs: number;
  temperature: number;
  maxTokens: number;
}

export interface IdentityConfig {
  defaultUserId: string;
  ragNamespacePrefix: string;
}

export interface FileStorageConfig {
  uploadRoot: string;
  reportRoot: string;
  maxUploadBytes: number;
  maxPdfPages: number;
  minPdfTextCharacters: number;
}

export interface AppConfig {
  server: ServerConfig;
  llm: LlmRuntimeConfig;
  identity: IdentityConfig;
  files: FileStorageConfig;
  memory: ProductionMemoryConfig;
  rag: ProductionRagConfig;
}

function resolveProjectPath(pathValue: string): string {
  if (isAbsolute(pathValue)) {
    return pathValue;
  }

  return resolve(projectRoot, pathValue);
}

function parseApplicationEnvironment(
  env: NodeJS.ProcessEnv,
): RawAppEnvironment {
  const result = appEnvironmentSchema.safeParse(env);

  if (!result.success) {
    throw new Error(
      [
        "文档问答应用环境变量不完整：",
        z.prettifyError(result.error),
      ].join("\n"),
    );
  }

  return result.data;
}

export function loadAppConfig(
  env: NodeJS.ProcessEnv = process.env,
): AppConfig {
  const application = parseApplicationEnvironment(env);

  const memory = loadProductionMemoryConfig(env);
  const rag = loadProductionRagConfig(env);

  if (
    memory.QDRANT_COLLECTION ===
    rag.RAG_QDRANT_COLLECTION
  ) {
    throw new Error(
      [
        "Memory 与 RAG 不能使用相同的 Qdrant collection。",
        `当前值：${memory.QDRANT_COLLECTION}`,
        "请分别设置 QDRANT_COLLECTION 和 RAG_QDRANT_COLLECTION。",
      ].join("\n"),
    );
  }

  return {
    server: {
      nodeEnv: application.NODE_ENV,
      host: application.HOST,
      port: application.PORT,
      logLevel: application.LOG_LEVEL,
    },

    llm: {
      provider: application.LLM_PROVIDER,
      apiKey: application.LLM_API_KEY,
      baseURL: application.LLM_BASE_URL,
      model: application.LLM_MODEL_ID,
      timeoutMs: application.LLM_TIMEOUT_MS,
      temperature: application.LLM_TEMPERATURE,
      maxTokens: application.LLM_MAX_TOKENS,
    },

    identity: {
      defaultUserId:
        application.APP_DEFAULT_USER_ID,
      ragNamespacePrefix:
        application.RAG_NAMESPACE_PREFIX,
    },

    files: {
    uploadRoot: resolveProjectPath(
        application.UPLOAD_ROOT,
    ),

    reportRoot: resolveProjectPath(
        application.REPORT_ROOT,
    ),

    maxUploadBytes:
        application.MAX_UPLOAD_BYTES,

    maxPdfPages:
        application.MAX_PDF_PAGES,

    minPdfTextCharacters:
        application.MIN_PDF_TEXT_CHARACTERS,
    },

    memory: {
      ...memory,
      MEMORY_SQLITE_PATH: resolveProjectPath(
        memory.MEMORY_SQLITE_PATH,
      ),
    },

    rag: {
      ...rag,
      RAG_SQLITE_PATH: resolveProjectPath(
        rag.RAG_SQLITE_PATH,
      ),
      RAG_KNOWLEDGE_ROOT: resolveProjectPath(
        rag.RAG_KNOWLEDGE_ROOT,
      ),
    },
  };
}

export function toSafeConfigSummary(
  config: AppConfig,
): Record<string, unknown> {
  return {
    server: config.server,

    identity: config.identity,

    llm: {
      provider: config.llm.provider,
      baseURL: config.llm.baseURL,
      model: config.llm.model,
      timeoutMs: config.llm.timeoutMs,
      temperature: config.llm.temperature,
      maxTokens: config.llm.maxTokens,
    },

    embedding: {
      baseURL: config.rag.EMBEDDING_BASE_URL,
      model: config.rag.EMBEDDING_MODEL,
      dimension: config.rag.EMBEDDING_DIMENSION,
      sendDimensions:
        config.rag.EMBEDDING_SEND_DIMENSIONS,
    },

    qdrant: {
      url: config.rag.QDRANT_URL,
      memoryCollection:
        config.memory.QDRANT_COLLECTION,
      ragCollection:
        config.rag.RAG_QDRANT_COLLECTION,
      hasApiKey:
        Boolean(config.rag.QDRANT_API_KEY),
    },

    neo4j: {
      uri: config.memory.NEO4J_URI,
      database: config.memory.NEO4J_DATABASE,
    },

    files: {
    uploadRoot: config.files.uploadRoot,
    knowledgeRoot:
        config.rag.RAG_KNOWLEDGE_ROOT,
    reportRoot: config.files.reportRoot,
    memorySqlite:
        config.memory.MEMORY_SQLITE_PATH,
    ragSqlite:
        config.rag.RAG_SQLITE_PATH,
    maxUploadBytes:
        config.files.maxUploadBytes,
    maxPdfPages:
        config.files.maxPdfPages,
    minPdfTextCharacters:
        config.files.minPdfTextCharacters,
    },

    rag: {
      chunkTokens:
        config.rag.RAG_CHUNK_TOKENS,
      chunkOverlapTokens:
        config.rag.RAG_CHUNK_OVERLAP_TOKENS,
    },
  };
}