export const supportedProviders = [
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
] as const;

export type LlmProvider = (typeof supportedProviders)[number];

/**
 * 创建统一 LLM 客户端时可以传入的参数。
 *
 * 优先级：
 * 构造参数 > 环境变量 > Provider 默认值
 */
export interface HelloAgentsLlmOptions {
  model?: string;
  apiKey?: string;
  baseURL?: string;
  provider?: LlmProvider;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;

  /**
   * 主要用于测试。
   * 正常运行时不传，默认使用 process.env。
   */
  env?: NodeJS.ProcessEnv;
}

/**
 * 单次模型调用可以覆盖的参数。
 */
export interface InvocationOptions {
  temperature?: number;
  maxTokens?: number;
}

/**
 * 完成 Provider 检测和凭证解析后的最终配置。
 */
export interface ResolvedLlmConfig {
  provider: LlmProvider;
  model: string;
  apiKey: string;
  baseURL: string;
  temperature: number;
  maxTokens?: number;
  timeoutMs: number;
}
