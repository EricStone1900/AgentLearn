import { isAbsolute } from "node:path";
import { describe, expect, it } from "vitest";
import {
  loadAppConfig,
  toSafeConfigSummary,
} from "../src/config/app-config.js";

function createValidEnvironment(
  overrides: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "test",
    HOST: "127.0.0.1",
    PORT: "3000",
    LOG_LEVEL: "silent",

    APP_DEFAULT_USER_ID: "test-user",
    RAG_NAMESPACE_PREFIX: "document-qa",

    UPLOAD_ROOT: "./uploads",
    REPORT_ROOT: "./reports",
    MAX_UPLOAD_BYTES: "26214400",
    MAX_PDF_PAGES: "300",
    MIN_PDF_TEXT_CHARACTERS: "20",

    LLM_PROVIDER: "custom",
    LLM_API_KEY: "test-llm-secret",
    LLM_BASE_URL: "https://llm.example.com/v1",
    LLM_MODEL_ID: "test-chat-model",
    LLM_TIMEOUT_MS: "60000",
    LLM_TEMPERATURE: "0.2",
    LLM_MAX_TOKENS: "2048",

    EMBEDDING_API_KEY: "test-embedding-secret",
    EMBEDDING_BASE_URL: "https://embedding.example.com/v1",
    EMBEDDING_MODEL: "test-embedding-model",
    EMBEDDING_DIMENSION: "1024",
    EMBEDDING_SEND_DIMENSIONS: "true",

    MEMORY_SQLITE_PATH: "./data/test-memory.sqlite",
    MEMORY_OUTBOX_MAX_ATTEMPTS: "5",

    RAG_SQLITE_PATH: "./data/test-rag.sqlite",
    RAG_KNOWLEDGE_ROOT: "./knowledge",
    RAG_CHUNK_TOKENS: "800",
    RAG_CHUNK_OVERLAP_TOKENS: "100",

    QDRANT_URL: "http://127.0.0.1:6333",
    QDRANT_API_KEY: "test-qdrant-secret",
    QDRANT_COLLECTION: "test_memories_v1",
    RAG_QDRANT_COLLECTION: "test_rag_v1",

    NEO4J_URI: "bolt://127.0.0.1:7687",
    NEO4J_USERNAME: "neo4j",
    NEO4J_PASSWORD: "test-neo4j-secret",
    NEO4J_DATABASE: "neo4j",

    ...overrides,
  };
}

describe("loadAppConfig", () => {
  it("解析并组织完整应用配置", () => {
    const config = loadAppConfig(createValidEnvironment());
    expect(config.files.maxPdfPages).toBe(300);

    expect(config.files.minPdfTextCharacters).toBe(20);

    expect(config.server).toEqual({
      nodeEnv: "test",
      host: "127.0.0.1",
      port: 3000,
      logLevel: "silent",
    });

    expect(config.llm).toEqual({
      provider: "custom",
      apiKey: "test-llm-secret",
      baseURL: "https://llm.example.com/v1",
      model: "test-chat-model",
      timeoutMs: 60000,
      temperature: 0.2,
      maxTokens: 2048,
    });

    expect(config.memory.EMBEDDING_DIMENSION).toBe(1024);

    expect(config.rag.EMBEDDING_DIMENSION).toBe(1024);
  });

  it("将文件路径转换为绝对路径", () => {
    const config = loadAppConfig(createValidEnvironment());

    expect(isAbsolute(config.files.uploadRoot)).toBe(true);

    expect(isAbsolute(config.files.reportRoot)).toBe(true);

    expect(isAbsolute(config.memory.MEMORY_SQLITE_PATH)).toBe(true);

    expect(isAbsolute(config.rag.RAG_SQLITE_PATH)).toBe(true);

    expect(isAbsolute(config.rag.RAG_KNOWLEDGE_ROOT)).toBe(true);
  });

  it("拒绝相同的 Memory 和 RAG collection", () => {
    expect(() => {
      loadAppConfig(
        createValidEnvironment({
          QDRANT_COLLECTION: "shared_collection",
          RAG_QDRANT_COLLECTION: "shared_collection",
        }),
      );
    }).toThrow("Memory 与 RAG 不能使用相同的 Qdrant collection");
  });

  it("拒绝大于等于 chunkTokens 的 overlap", () => {
    expect(() => {
      loadAppConfig(
        createValidEnvironment({
          RAG_CHUNK_TOKENS: "100",
          RAG_CHUNK_OVERLAP_TOKENS: "100",
        }),
      );
    }).toThrow("RAG 环境变量不完整");
  });

  it("拒绝缺少 LLM API Key", () => {
    expect(() => {
      loadAppConfig(
        createValidEnvironment({
          LLM_API_KEY: "",
        }),
      );
    }).toThrow("文档问答应用环境变量不完整");
  });

  it("安全摘要不包含任何密钥和密码", () => {
    const config = loadAppConfig(createValidEnvironment());

    const summaryText = JSON.stringify(toSafeConfigSummary(config));

    expect(summaryText).not.toContain("test-llm-secret");

    expect(summaryText).not.toContain("test-embedding-secret");

    expect(summaryText).not.toContain("test-qdrant-secret");

    expect(summaryText).not.toContain("test-neo4j-secret");

    expect(summaryText).toContain("test-chat-model");

    expect(summaryText).toContain("test_memories_v1");

    expect(summaryText).toContain("test_rag_v1");
  });

  it("拒绝非法 PDF 页数限制", () => {
    expect(() => {
      loadAppConfig(
        createValidEnvironment({
          MAX_PDF_PAGES: "0",
        }),
      );
    }).toThrow("文档问答应用环境变量不完整");
  });
});
