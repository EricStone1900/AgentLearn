import { describe, expect, it } from "vitest";

import { Config } from "../src/core/config.js";

describe("Config", () => {
  it("能够使用默认配置", () => {
    const config = new Config();

    expect(config.temperature).toBe(0.7);
    expect(config.debug).toBe(false);
    expect(config.logLevel).toBe("INFO");
    expect(config.maxHistoryLength).toBe(100);
  });

  it("构造参数能够覆盖默认值", () => {
    const config = new Config({
      temperature: 0.2,
      debug: true,
      maxHistoryLength: 20,
    });

    expect(config.temperature).toBe(0.2);
    expect(config.debug).toBe(true);
    expect(config.maxHistoryLength).toBe(20);
  });

  it("能够从环境变量创建配置", () => {
    const config = Config.fromEnv({
      LLM_MODEL_ID: "test-model",
      LLM_PROVIDER: "deepseek",
      LLM_TEMPERATURE: "0.3",
      LLM_MAX_TOKENS: "2048",
      DEBUG: "true",
      LOG_LEVEL: "debug",
      MAX_HISTORY_LENGTH: "50",
    });

    expect(config.defaultModel).toBe("test-model");

    expect(config.defaultProvider).toBe("deepseek");

    expect(config.temperature).toBe(0.3);
    expect(config.maxTokens).toBe(2048);
    expect(config.debug).toBe(true);
    expect(config.logLevel).toBe("DEBUG");
    expect(config.maxHistoryLength).toBe(50);
  });

  it("拒绝非法 temperature", () => {
    expect(() => {
      new Config({
        temperature: 3,
      });
    }).toThrow();
  });

  it("拒绝非法布尔环境变量", () => {
    expect(() => {
      Config.fromEnv({
        DEBUG: "yes",
      });
    }).toThrow("DEBUG 必须是 true 或 false");
  });

  it("能够转换为普通对象", () => {
    const config = new Config({
      debug: true,
    });

    expect(config.toObject()).toEqual({
      defaultModel: "gpt-3.5-turbo",
      defaultProvider: "openai",
      temperature: 0.7,
      maxTokens: undefined,
      debug: true,
      logLevel: "INFO",
      maxHistoryLength: 100,
    });
  });
});
