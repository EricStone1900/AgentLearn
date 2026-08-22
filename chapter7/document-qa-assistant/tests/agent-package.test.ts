import {
  FunctionCallAgent,
  HelloAgentsLlm,
  ToolRegistry,
} from "@ericstone/agent-patterns-ts";

import type {
  LlmClient,
  NativeToolCallingLlmClient,
} from "@ericstone/agent-patterns-ts/core";

import { createDefaultToolRegistry } from "@ericstone/agent-patterns-ts/tools";

import {
  createInMemoryMemoryManager,
  createProductionMemoryManager,
} from "@ericstone/agent-patterns-ts/memory";

import {
  createProductionRag,
  RagService,
} from "@ericstone/agent-patterns-ts/rag";

import { describe, expect, it } from "vitest";

describe("@ericstone/agent-patterns-ts", () => {
  it("导出 Agent、LLM 和工具注册表", () => {
    expect(HelloAgentsLlm).toBeTypeOf("function");
    expect(FunctionCallAgent).toBeTypeOf("function");
    expect(ToolRegistry).toBeTypeOf("function");
  });

  it("导出 Memory 和 RAG 工厂", () => {
    expect(createInMemoryMemoryManager).toBeTypeOf("function");

    expect(createProductionMemoryManager).toBeTypeOf("function");

    expect(createProductionRag).toBeTypeOf("function");

    expect(RagService).toBeTypeOf("function");
  });

  it("能够创建带 MemoryTool 的注册表", () => {
    const manager = createInMemoryMemoryManager({
      userId: "stage-4-test-user",
    });

    const registry = createDefaultToolRegistry({
      includeSearch: false,
      memoryManager: manager,
    });

    expect(registry.has("memory")).toBe(true);
    expect(registry.has("rag")).toBe(false);
  });

  it("公共 LLM 类型可以被消费项目引用", () => {
    const typeAssertions = (
      llm: LlmClient,
      nativeLlm: NativeToolCallingLlmClient,
    ): void => {
      expect(llm.generate).toBeTypeOf("function");
      expect(nativeLlm.createToolCompletion).toBeTypeOf("function");
    };

    expect(typeAssertions).toBeTypeOf("function");
  });
});
