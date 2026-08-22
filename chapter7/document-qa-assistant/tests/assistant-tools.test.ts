import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockedFunction,
} from "vitest";
import {
  createAssistantToolRegistry,
  type AssistantToolMemoryService,
  type AssistantToolRagService,
} from "../src/app/assistant-tools.js";

describe("Assistant Agent tools", () => {
  let ragSearch: MockedFunction<AssistantToolRagService["search"]>;

  let memorySearch: MockedFunction<
    AssistantToolMemoryService["retrieveMemories"]
  >;

  beforeEach(() => {
    ragSearch = vi.fn<AssistantToolRagService["search"]>(async () => []);

    memorySearch = vi.fn<AssistantToolMemoryService["retrieveMemories"]>(
      async () => [],
    );
  });

  function createRegistry() {
    return createAssistantToolRegistry({
      namespace: "document-qa:test-user",

      ragService: {
        search: ragSearch,
      },

      memoryManager: {
        retrieveMemories: memorySearch,
      },
    });
  }

  it("只注册两个只读工具", () => {
    const registry = createRegistry();

    expect(registry.listNames()).toEqual(["knowledge_search", "memory_search"]);

    expect(registry.has("rag")).toBe(false);
    expect(registry.has("memory")).toBe(false);
  });

  it("知识检索始终使用服务端固定 namespace", async () => {
    const registry = createRegistry();

    const result = await registry.executeDetailed("knowledge_search", {
      query: "什么是 RAG？",
      limit: 3,
      enableMqe: true,
      enableHyde: false,
    });

    expect(result.ok).toBe(true);

    expect(ragSearch).toHaveBeenCalledWith("什么是 RAG？", {
      namespace: "document-qa:test-user",
      limit: 3,
      enableMqe: true,
      enableHyde: false,
    });
  });

  it("记忆检索支持限制记忆类型", async () => {
    const registry = createRegistry();

    const result = await registry.executeDetailed("memory_search", {
      query: "我学习过什么？",
      memoryTypes: ["episodic", "semantic"],
      limit: 4,
    });

    expect(result.ok).toBe(true);

    expect(memorySearch).toHaveBeenCalledWith({
      query: "我学习过什么？",

      memoryTypes: ["episodic", "semantic"],

      limit: 4,
    });
  });

  it("拒绝不合法的工具参数", async () => {
    const registry = createRegistry();

    const result = await registry.executeDetailed("knowledge_search", {
      query: "",
      limit: 100,
    });

    expect(result.ok).toBe(false);

    expect(ragSearch).not.toHaveBeenCalled();
  });

  it("不存在写入和删除工具", async () => {
    const registry = createRegistry();

    const result = await registry.executeDetailed("memory_clear", {
      confirm: true,
    });

    expect(result.ok).toBe(false);
  });
});
