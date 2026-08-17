import { describe, expect, it } from "vitest";

import { MyLlm } from "../src/extensions/my-llm.js";

describe("MyLlm", () => {
  it("能够为 ModelScope 提供自定义默认配置", () => {
    const llm = new MyLlm({
      provider: "modelscope",
      env: {
        MODELSCOPE_API_KEY: "test-key",
      },
    });

    expect(llm.provider).toBe("modelscope");
    expect(llm.model).toBe("Qwen/Qwen2.5-72B-Instruct");

    expect(llm.getInfo().baseURL).toBe(
      "https://api-inference.modelscope.cn/v1/",
    );
  });

  it("构造参数优先于环境变量", () => {
    const llm = new MyLlm({
      provider: "modelscope",
      apiKey: "parameter-key",
      model: "parameter-model",
      baseURL: "https://example.com/v1",
      env: {
        MODELSCOPE_API_KEY: "environment-key",
        LLM_MODEL_ID: "environment-model",
      },
    });

    const info = llm.getInfo();

    expect(info.model).toBe("parameter-model");
    expect(info.baseURL).toBe("https://example.com/v1");
  });

  it("其他 Provider 会交给父类处理", () => {
    const llm = new MyLlm({
      provider: "ollama",
      env: {},
    });

    expect(llm.provider).toBe("ollama");
    expect(llm.getInfo().baseURL).toBe("http://localhost:11434/v1");
  });

  it("缺少 ModelScope API Key 时拒绝初始化", () => {
    expect(() => {
      new MyLlm({
        provider: "modelscope",
        env: {},
      });
    }).toThrow("ModelScope API Key 未配置");
  });
});
