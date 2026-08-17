import type {
  HelloAgentsLlmOptions,
  LlmProvider,
  ResolvedLlmConfig,
} from "./llm-types.js";
import { LlmConfigError } from "./errors.js";

interface ProviderDefinition {
  apiKeyEnvNames: string[];
  baseUrlEnvNames: string[];
  defaultApiKey?: string;
  defaultBaseURL: string;
  defaultModel: string;
}

const providerDefinitions: Record<
  Exclude<LlmProvider, "auto" | "custom">,
  ProviderDefinition
> = {
  openai: {
    apiKeyEnvNames: ["OPENAI_API_KEY", "LLM_API_KEY"],
    baseUrlEnvNames: ["LLM_BASE_URL"],
    defaultBaseURL: "https://api.openai.com/v1",
    defaultModel: "gpt-3.5-turbo",
  },

  deepseek: {
    apiKeyEnvNames: ["DEEPSEEK_API_KEY", "LLM_API_KEY"],
    baseUrlEnvNames: ["LLM_BASE_URL"],
    defaultBaseURL: "https://api.deepseek.com",
    defaultModel: "deepseek-v4-flash",
  },

  qwen: {
    apiKeyEnvNames: ["DASHSCOPE_API_KEY", "LLM_API_KEY"],
    baseUrlEnvNames: ["LLM_BASE_URL"],
    defaultBaseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    defaultModel: "qwen-plus",
  },

  modelscope: {
    apiKeyEnvNames: ["MODELSCOPE_API_KEY", "LLM_API_KEY"],
    baseUrlEnvNames: ["LLM_BASE_URL"],
    defaultBaseURL: "https://api-inference.modelscope.cn/v1/",
    defaultModel: "Qwen/Qwen2.5-72B-Instruct",
  },

  kimi: {
    apiKeyEnvNames: ["KIMI_API_KEY", "MOONSHOT_API_KEY", "LLM_API_KEY"],
    baseUrlEnvNames: ["LLM_BASE_URL"],
    defaultBaseURL: "https://api.moonshot.cn/v1",
    defaultModel: "moonshot-v1-8k",
  },

  zhipu: {
    apiKeyEnvNames: ["ZHIPU_API_KEY", "GLM_API_KEY", "LLM_API_KEY"],
    baseUrlEnvNames: ["LLM_BASE_URL"],
    defaultBaseURL: "https://open.bigmodel.cn/api/paas/v4",
    defaultModel: "glm-4",
  },

  ollama: {
    apiKeyEnvNames: ["OLLAMA_API_KEY", "LLM_API_KEY"],
    baseUrlEnvNames: ["OLLAMA_HOST", "LLM_BASE_URL"],
    defaultApiKey: "ollama",
    defaultBaseURL: "http://localhost:11434/v1",
    defaultModel: "llama3.2",
  },

  vllm: {
    apiKeyEnvNames: ["VLLM_API_KEY", "LLM_API_KEY"],
    baseUrlEnvNames: ["VLLM_HOST", "LLM_BASE_URL"],
    defaultApiKey: "vllm",
    defaultBaseURL: "http://localhost:8000/v1",
    defaultModel: "local-model",
  },

  local: {
    apiKeyEnvNames: ["LLM_API_KEY"],
    baseUrlEnvNames: ["LLM_BASE_URL"],
    defaultApiKey: "local",
    defaultBaseURL: "http://localhost:8000/v1",
    defaultModel: "local-model",
  },
};

function firstNonEmptyEnvironmentValue(
  env: NodeJS.ProcessEnv,
  names: string[],
): string | undefined {
  for (const name of names) {
    const value = env[name]?.trim();

    if (value) {
      return value;
    }
  }

  return undefined;
}

function parseOptionalNumber(
  value: string | undefined,
  name: string,
): number | undefined {
  if (value === undefined || value.trim() === "") {
    return undefined;
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    throw new LlmConfigError(`${name} 必须是有效数字`);
  }

  return parsed;
}

export function autoDetectProvider(
  apiKey: string | undefined,
  baseURL: string | undefined,
  env: NodeJS.ProcessEnv,
): LlmProvider {
  // 1. 优先检查 Provider 专属环境变量
  if (env.OPENAI_API_KEY) {
    return "openai";
  }

  if (env.DEEPSEEK_API_KEY) {
    return "deepseek";
  }

  if (env.DASHSCOPE_API_KEY) {
    return "qwen";
  }

  if (env.MODELSCOPE_API_KEY) {
    return "modelscope";
  }

  if (env.KIMI_API_KEY || env.MOONSHOT_API_KEY) {
    return "kimi";
  }

  if (env.ZHIPU_API_KEY || env.GLM_API_KEY) {
    return "zhipu";
  }

  if (env.OLLAMA_API_KEY || env.OLLAMA_HOST) {
    return "ollama";
  }

  if (env.VLLM_API_KEY || env.VLLM_HOST) {
    return "vllm";
  }

  // 2. 根据 API Key 的特殊格式判断
  const actualApiKey = apiKey ?? env.LLM_API_KEY;

  if (actualApiKey) {
    const normalizedApiKey = actualApiKey.toLowerCase();

    if (actualApiKey.startsWith("ms-")) {
      return "modelscope";
    }

    if (normalizedApiKey === "ollama") {
      return "ollama";
    }

    if (normalizedApiKey === "vllm") {
      return "vllm";
    }

    if (normalizedApiKey === "local") {
      return "local";
    }

    const apiKeyTail = actualApiKey.slice(-20);

    if (actualApiKey.endsWith(".") || apiKeyTail.includes(".")) {
      return "zhipu";
    }
  }

  // 3. 根据 Base URL 判断
  const actualBaseURL = baseURL ?? env.LLM_BASE_URL;

  if (actualBaseURL) {
    const normalizedBaseURL = actualBaseURL.toLowerCase();

    if (normalizedBaseURL.includes("api.openai.com")) {
      return "openai";
    }

    if (normalizedBaseURL.includes("api.deepseek.com")) {
      return "deepseek";
    }

    if (normalizedBaseURL.includes("dashscope.aliyuncs.com")) {
      return "qwen";
    }

    if (normalizedBaseURL.includes("api-inference.modelscope.cn")) {
      return "modelscope";
    }

    if (normalizedBaseURL.includes("api.moonshot.cn")) {
      return "kimi";
    }

    if (normalizedBaseURL.includes("open.bigmodel.cn")) {
      return "zhipu";
    }

    const isLocal =
      normalizedBaseURL.includes("localhost") ||
      normalizedBaseURL.includes("127.0.0.1");

    if (isLocal) {
      if (
        normalizedBaseURL.includes(":11434") ||
        normalizedBaseURL.includes("ollama")
      ) {
        return "ollama";
      }

      if (
        normalizedBaseURL.includes(":8000") &&
        (normalizedBaseURL.includes("vllm") ||
          actualApiKey?.toLowerCase() === "vllm")
      ) {
        return "vllm";
      }

      return "local";
    }
  }

  return "auto";
}

function isKnownProvider(value: string): value is LlmProvider {
  return [
    "openai",
    "deepseek",
    "qwen",
    "modelscope",
    "kimi",
    "zhipu",
    "ollama",
    "vllm",
    "local",
    "auto",
    "custom",
  ].includes(value);
}

function readEnvironmentProvider(
  env: NodeJS.ProcessEnv,
): LlmProvider | undefined {
  const value = env.LLM_PROVIDER?.trim().toLowerCase();

  if (!value) {
    return undefined;
  }

  if (!isKnownProvider(value)) {
    throw new LlmConfigError(`不支持的 LLM_PROVIDER：${value}`);
  }

  return value;
}

export function resolveLlmConfig(
  options: HelloAgentsLlmOptions,
): ResolvedLlmConfig {
  const env = options.env ?? process.env;

  const requestedProvider =
    options.provider ?? readEnvironmentProvider(env) ?? "auto";

  const provider =
    requestedProvider === "auto"
      ? autoDetectProvider(options.apiKey, options.baseURL, env)
      : requestedProvider;

  let apiKey: string | undefined;
  let baseURL: string | undefined;
  let defaultModel: string;

  if (provider === "auto" || provider === "custom") {
    apiKey =
      options.apiKey ?? firstNonEmptyEnvironmentValue(env, ["LLM_API_KEY"]);

    baseURL =
      options.baseURL ?? firstNonEmptyEnvironmentValue(env, ["LLM_BASE_URL"]);

    defaultModel = "gpt-3.5-turbo";
  } else {
    const definition = providerDefinitions[provider];

    apiKey =
      options.apiKey ??
      firstNonEmptyEnvironmentValue(env, definition.apiKeyEnvNames) ??
      definition.defaultApiKey;

    baseURL =
      options.baseURL ??
      firstNonEmptyEnvironmentValue(env, definition.baseUrlEnvNames) ??
      definition.defaultBaseURL;

    defaultModel = definition.defaultModel;
  }

  const model = options.model ?? env.LLM_MODEL_ID?.trim() ?? defaultModel;

  const temperature =
    options.temperature ??
    parseOptionalNumber(env.LLM_TEMPERATURE, "LLM_TEMPERATURE") ??
    0.7;

  const maxTokens =
    options.maxTokens ??
    parseOptionalNumber(env.LLM_MAX_TOKENS, "LLM_MAX_TOKENS");

  const timeoutMs =
    options.timeoutMs ??
    parseOptionalNumber(env.LLM_TIMEOUT_MS, "LLM_TIMEOUT_MS") ??
    60_000;

  if (!apiKey) {
    throw new LlmConfigError(`Provider "${provider}" 缺少 API Key`);
  }

  if (!baseURL) {
    throw new LlmConfigError(`Provider "${provider}" 缺少 Base URL`);
  }

  if (!model) {
    throw new LlmConfigError("缺少模型 ID");
  }

  if (!Number.isFinite(temperature) || temperature < 0 || temperature > 2) {
    throw new LlmConfigError("temperature 必须是 0 到 2 之间的数字");
  }

  if (
    maxTokens !== undefined &&
    (!Number.isInteger(maxTokens) || maxTokens <= 0)
  ) {
    throw new LlmConfigError("maxTokens 必须是正整数");
  }

  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new LlmConfigError("timeoutMs 必须是正整数");
  }

  try {
    new URL(baseURL);
  } catch {
    throw new LlmConfigError(`Base URL 不是合法 URL：${baseURL}`);
  }

  return {
    provider,
    model,
    apiKey,
    baseURL,
    temperature,
    timeoutMs,

    ...(maxTokens === undefined ? {} : { maxTokens }),
  };
}
