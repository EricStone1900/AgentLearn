import {
  autoDetectProvider,
  resolveLlmConfig,
} from "../src/core/llm-provider.js";
import { describe, expect, it } from "vitest";

describe("LLM Provider", () => {
  it("能够根据 OpenAI 专属环境变量检测 Provider", () => {
    const provider = autoDetectProvider(undefined, undefined, {
      OPENAI_API_KEY: "test-key",
    });

    expect(provider).toBe("openai");
  });

  it("能够根据 Ollama 地址检测 Provider", () => {
    const provider = autoDetectProvider(
      undefined,
      "http://localhost:11434/v1",
      {},
    );

    expect(provider).toBe("ollama");
  });

  it("显式 Provider 优先于自动检测", () => {
    const config = resolveLlmConfig({
      provider: "deepseek",
      apiKey: "test-key",
      model: "test-model",
      env: {
        OPENAI_API_KEY: "another-key",
      },
    });

    expect(config.provider).toBe("deepseek");
    expect(config.baseURL).toBe("https://api.deepseek.com");
  });

  it("Ollama 可以使用本地默认配置", () => {
    const config = resolveLlmConfig({
      provider: "ollama",
      model: "llama3",
      env: {},
    });

    expect(config.apiKey).toBe("ollama");
    expect(config.baseURL).toBe("http://localhost:11434/v1");
  });

  it("custom 缺少 Base URL 时拒绝启动", () => {
    expect(() => {
      resolveLlmConfig({
        provider: "custom",
        apiKey: "test-key",
        model: "test-model",
        env: {},
      });
    }).toThrow("缺少 Base URL");
  });
});
