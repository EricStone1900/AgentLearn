import { advancedCalculatorTool } from "./advanced-calculator.js";

import { createHybridSearchToolFromEnv } from "./search/hybrid-search.js";

import { ToolRegistry } from "./tool.js";

export interface CreateDefaultToolRegistryOptions {
  env?: NodeJS.ProcessEnv;
  includeSearch?: boolean;
}

/**
 * 创建一套默认工具。
 *
 * 每次调用都会返回新的 ToolRegistry，
 * 避免不同 Agent 或测试之间共享可变状态。
 */
export function createDefaultToolRegistry(
  options: CreateDefaultToolRegistryOptions = {},
): ToolRegistry {
  const env = options.env ?? process.env;

  const includeSearch = options.includeSearch ?? true;

  const registry = new ToolRegistry();

  /*
   * 数学工具不依赖外部服务，始终注册。
   */
  registry.register(advancedCalculatorTool);

  /*
   * 搜索工具依赖 API Key。
   *
   * 只要 Tavily 或 SerpAPI 中至少配置一个，
   * 就可以注册混合搜索工具。
   */
  const hasSearchApiKey = Boolean(
    env.TAVILY_API_KEY?.trim() || env.SERPAPI_API_KEY?.trim(),
  );

  if (includeSearch && hasSearchApiKey) {
    registry.register(createHybridSearchToolFromEnv(env));
  }

  return registry;
}
