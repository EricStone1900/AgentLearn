import { HelloAgentsLlm } from "../core/hello-agents-llm.js";
import type { HelloAgentsLlmOptions } from "../core/llm-types.js";
import { LlmConfigError } from "../core/errors.js";

function firstNonEmpty(
  ...values: Array<string | undefined>
): string | undefined {
  for (const value of values) {
    const normalized = value?.trim();

    if (normalized) {
      return normalized;
    }
  }

  return undefined;
}

export class MyLlm extends HelloAgentsLlm {
  public constructor(options: HelloAgentsLlmOptions = {}) {
    const env = options.env ?? process.env;

    const environmentProvider = env.LLM_PROVIDER?.trim().toLowerCase();

    const requestedProvider = options.provider ?? environmentProvider;

    /*
     * 如果不是我们要扩展的 ModelScope，
     * 就完全交给父类处理。
     */
    if (requestedProvider !== "modelscope") {
      super(options);
      return;
    }

    /*
     * 下面只处理 ModelScope 的定制逻辑。
     */
    const apiKey = firstNonEmpty(
      options.apiKey,
      env.MODELSCOPE_API_KEY,
      env.LLM_API_KEY,
    );

    if (!apiKey) {
      throw new LlmConfigError(
        [
          "ModelScope API Key 未配置。",
          "请设置 MODELSCOPE_API_KEY，",
          "或者在构造函数中传入 apiKey。",
        ].join(""),
      );
    }

    const baseURL =
      firstNonEmpty(options.baseURL, env.LLM_BASE_URL) ??
      "https://api-inference.modelscope.cn/v1/";

    const model =
      firstNonEmpty(options.model, env.LLM_MODEL_ID) ??
      "Qwen/Qwen2.5-72B-Instruct";

    /*
     * 把解析后的配置交给父类。
     *
     * 父类继续负责：
     * 1. 验证参数
     * 2. 创建 OpenAI SDK 客户端
     * 3. invoke/streamInvoke/think
     */
    super({
      ...options,
      provider: "modelscope",
      apiKey,
      baseURL,
      model,
    });
  }
}
