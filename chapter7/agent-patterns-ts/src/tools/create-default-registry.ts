import type { MemoryManager } from "../memory/manager.js";
import { advancedCalculatorTool } from "./advanced-calculator.js";
import { createMemoryTool } from "./memory-tool.js";
import { createHybridSearchToolFromEnv } from "./search/hybrid-search.js";
import { ToolRegistry } from "./tool.js";
import type { RagService } from "../rag/rag-service.js";
import { createRagTool } from "./rag-tool.js";

export interface CreateDefaultToolRegistryOptions {
  env?: NodeJS.ProcessEnv;
  includeSearch?: boolean;
  memoryManager?: MemoryManager;
}

export interface CreateDefaultToolRegistryOptions {
  env?: NodeJS.ProcessEnv;
  includeSearch?: boolean;
  memoryManager?: MemoryManager;
  ragService?: RagService;
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

  registry.register(advancedCalculatorTool);

  const hasSearchApiKey = Boolean(
    env.TAVILY_API_KEY?.trim() || env.SERPAPI_API_KEY?.trim(),
  );

  if (includeSearch && hasSearchApiKey) {
    registry.register(createHybridSearchToolFromEnv(env));
  }

  if (options.memoryManager) {
    registry.register(createMemoryTool(options.memoryManager));
  }

  if (options.ragService) {
    registry.register(createRagTool(options.ragService));
  }

  return registry;
}
