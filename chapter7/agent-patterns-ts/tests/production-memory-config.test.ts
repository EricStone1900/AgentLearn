import { describe, expect, it } from "vitest";
import { loadProductionMemoryConfig } from "../src/memory/production-memory-config.js";

function validEnv(): NodeJS.ProcessEnv {
  return {
    MEMORY_SQLITE_PATH: ".data/test.sqlite",
    EMBEDDING_API_KEY: "test-key",
    EMBEDDING_BASE_URL: "https://api.siliconflow.com/v1",
    EMBEDDING_MODEL: "Qwen/Qwen3-Embedding-0.6B",
    EMBEDDING_DIMENSION: "1024",
    EMBEDDING_SEND_DIMENSIONS: "true",
    QDRANT_URL: "http://127.0.0.1:6333",
    QDRANT_API_KEY: "",
    QDRANT_COLLECTION: "test_memories",
    NEO4J_URI: "bolt://127.0.0.1:7687",
    NEO4J_USERNAME: "neo4j",
    NEO4J_PASSWORD: "password",
    NEO4J_DATABASE: "neo4j",
  };
}

describe("loadProductionMemoryConfig", () => {
  it("能够解析第二阶段配置", () => {
    const config = loadProductionMemoryConfig(validEnv());

    expect(config.EMBEDDING_DIMENSION).toBe(1024);
    expect(config.MEMORY_OUTBOX_MAX_ATTEMPTS).toBe(5);
    expect(config.QDRANT_API_KEY).toBeUndefined();
  });

  it("能够配置 Outbox 最大尝试次数", () => {
    const env = validEnv();
    env.MEMORY_OUTBOX_MAX_ATTEMPTS = "8";

    expect(
      loadProductionMemoryConfig(env).MEMORY_OUTBOX_MAX_ATTEMPTS,
    ).toBe(8);

    env.MEMORY_OUTBOX_MAX_ATTEMPTS = "0";
    expect(() => loadProductionMemoryConfig(env)).toThrow(
      "第二阶段记忆系统环境变量不完整",
    );
  });

  it("可以切换其他兼容厂商、模型和维度", () => {
    const env = validEnv();
    env.EMBEDDING_BASE_URL = "https://embedding.example.com/v1";
    env.EMBEDDING_MODEL = "vendor/embedding-model-v2";
    env.EMBEDDING_DIMENSION = "768";
    env.EMBEDDING_SEND_DIMENSIONS = "false";
    env.QDRANT_COLLECTION = "agent_memories_v2";

    const config = loadProductionMemoryConfig(env);

    expect(config.EMBEDDING_BASE_URL).toBe("https://embedding.example.com/v1");
    expect(config.EMBEDDING_MODEL).toBe("vendor/embedding-model-v2");
    expect(config.EMBEDDING_DIMENSION).toBe(768);
    expect(config.EMBEDDING_SEND_DIMENSIONS).toBe(false);
    expect(config.QDRANT_COLLECTION).toBe("agent_memories_v2");
  });

  it("缺少必要配置时立即失败", () => {
    const env = validEnv();
    delete env.NEO4J_PASSWORD;

    expect(() => loadProductionMemoryConfig(env)).toThrow(
      "第二阶段记忆系统环境变量不完整",
    );
  });
});
