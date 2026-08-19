import { describe, expect, it } from "vitest";

import { createInMemoryMemoryManager } from "../src/memory/create-in-memory-manager.js";
import type {
  MemoryItem,
  MemoryType,
} from "../src/memory/schemas.js";
import type { MemoryManagerStats } from "../src/memory/manager.js";
import { createMemoryTool } from "../src/tools/memory-tool.js";
import { ToolRegistry } from "../src/tools/tool.js";

interface AddResponse {
  success: boolean;
  memoryId: string;
}

interface SearchResult {
  item: MemoryItem;
  score: number;
}

interface SearchResponse {
  success: boolean;
  count: number;
  results: SearchResult[];
}

interface BooleanResponse {
  success: boolean;
}

interface SummaryResponse {
  success: boolean;
  memories: MemoryItem[];
}

interface StatsResponse {
  success: boolean;
  stats: MemoryManagerStats;
}

interface ForgetResponse {
  success: boolean;
  forgottenCount: number;
}

interface ConsolidateResponse {
  success: boolean;
  consolidatedCount: number;
}

/**
 * MemoryTool 返回的是 JSON 字符串。
 *
 * 这个辅助函数负责把 JSON 字符串转换成测试需要的类型。
 * 泛型 T 只负责 TypeScript 类型提示，不会在运行时校验数据。
 */
function parseOutput<T>(output: string): T {
  return JSON.parse(output) as T;
}

/**
 * 为每个测试创建彼此隔离的 MemoryManager 和 ToolRegistry。
 *
 * 这样可以避免某个测试添加的记忆污染其他测试。
 */
function createSubject() {
  const fixedNow = new Date("2026-01-01T08:00:00.000Z");

  const manager = createInMemoryMemoryManager({
    userId: "test-user",
    now: () => new Date(fixedNow),
  });

  const registry = new ToolRegistry();
  registry.register(createMemoryTool(manager));

  return {
    manager,
    registry,
  };
}

describe("MemoryTool", () => {
  it("注册后可以通过 memory 名称找到工具", () => {
    const { registry } = createSubject();

    expect(registry.has("memory")).toBe(true);
    expect(registry.listNames()).toContain("memory");
  });

  it("可以转换为 OpenAI Function Calling 工具定义", () => {
    const { registry } = createSubject();

    const tools = registry.toOpenAiTools();

    expect(tools).toHaveLength(1);
    const tool = tools[0];

    if (!tool || tool.type !== "function") {
      throw new Error("memory 工具应转换为 OpenAI function tool");
    }

    expect(tool.function.name).toBe("memory");

    expect(tool.function.parameters).toMatchObject({
      type: "object",
    });
  });

  describe("add", () => {
    it("可以添加一条工作记忆", async () => {
      const { manager, registry } = createSubject();

      const execution = await registry.executeDetailed("memory", {
        action: "add",
        content: "用户正在学习 TypeScript 记忆系统",
        memoryType: "working",
        importance: 0.8,
        metadata: {
          source: "unit-test",
        },
      });

      expect(execution.ok).toBe(true);

      if (!execution.ok) {
        throw new Error(execution.output);
      }

      const response = parseOutput<AddResponse>(execution.output);

      expect(response.success).toBe(true);
      expect(response.memoryId).toEqual(expect.any(String));
      expect(response.memoryId.length).toBeGreaterThan(0);

      // 除了检查工具返回值，还要检查底层 MemoryManager 的状态。
      const memories = await manager.getSummary();

      expect(memories).toHaveLength(1);
      expect(memories[0]).toMatchObject({
        id: response.memoryId,
        content: "用户正在学习 TypeScript 记忆系统",
        memoryType: "working",
        importance: 0.8,
        metadata: {
          source: "unit-test",
        },
      });
    });

    it("未提供 content 时参数校验失败", async () => {
      const { registry } = createSubject();

      const execution = await registry.executeDetailed("memory", {
        action: "add",
        memoryType: "working",
      });

      expect(execution.ok).toBe(false);

      if (execution.ok) {
        throw new Error("add 缺少 content 时不应该执行成功");
      }

      expect(execution.output).toContain("参数不合法");
      expect(execution.error).toContain("add 操作需要 content");
    });

    it("importance 超出 0 到 1 时参数校验失败", async () => {
      const { registry } = createSubject();

      const execution = await registry.executeDetailed("memory", {
        action: "add",
        content: "一条重要性不合法的记忆",
        importance: 1.5,
      });

      expect(execution.ok).toBe(false);

      if (execution.ok) {
        throw new Error("importance 超出范围时不应该执行成功");
      }

      expect(execution.output).toContain("参数不合法");
    });
  });

  describe("search", () => {
    it("可以搜索已经添加的记忆", async () => {
      const { registry } = createSubject();

      await registry.execute("memory", {
        action: "add",
        content: "用户喜欢使用 TypeScript 编写智能体",
        memoryType: "working",
        importance: 0.9,
      });

      await registry.execute("memory", {
        action: "add",
        content: "今天的天气是晴天",
        memoryType: "working",
        importance: 0.5,
      });

      const execution = await registry.executeDetailed("memory", {
        action: "search",
        query: "TypeScript 智能体",
        memoryTypes: ["working"],
        limit: 5,
      });

      expect(execution.ok).toBe(true);

      if (!execution.ok) {
        throw new Error(execution.output);
      }

      const response = parseOutput<SearchResponse>(execution.output);

      expect(response.success).toBe(true);
      expect(response.count).toBeGreaterThan(0);
      expect(response.results.length).toBe(response.count);

      expect(
        response.results.some((result) =>
          result.item.content.includes("TypeScript"),
        ),
      ).toBe(true);

      expect(response.results[0]?.score).toEqual(expect.any(Number));
    });

    it("可以使用 memoryTypes 限制检索范围", async () => {
      const { registry } = createSubject();

      await registry.execute("memory", {
        action: "add",
        content: "TypeScript 是一种带类型的 JavaScript",
        memoryType: "semantic",
        importance: 0.8,
      });

      await registry.execute("memory", {
        action: "add",
        content: "用户今天学习了 TypeScript",
        memoryType: "episodic",
        importance: 0.8,
      });

      const output = await registry.execute("memory", {
        action: "search",
        query: "TypeScript",
        memoryTypes: ["semantic"],
        limit: 10,
      });

      const response = parseOutput<SearchResponse>(output);

      expect(response.success).toBe(true);
      expect(response.count).toBeGreaterThan(0);

      for (const result of response.results) {
        expect(result.item.memoryType).toBe("semantic");
      }
    });

    it("未提供 query 时参数校验失败", async () => {
      const { registry } = createSubject();

      const execution = await registry.executeDetailed("memory", {
        action: "search",
      });

      expect(execution.ok).toBe(false);

      if (execution.ok) {
        throw new Error("search 缺少 query 时不应该执行成功");
      }

      expect(execution.output).toContain("参数不合法");
      expect(execution.error).toContain("search 操作需要 query");
    });
  });

  describe("update", () => {
    it("可以更新一条已有记忆", async () => {
      const { manager, registry } = createSubject();

      const addOutput = await registry.execute("memory", {
        action: "add",
        content: "用户喜欢 JavaScript",
        memoryType: "working",
        importance: 0.5,
      });

      const added = parseOutput<AddResponse>(addOutput);

      const execution = await registry.executeDetailed("memory", {
        action: "update",
        memoryId: added.memoryId,
        content: "用户喜欢 TypeScript",
        importance: 0.9,
        metadata: {
          corrected: true,
        },
      });

      expect(execution.ok).toBe(true);

      if (!execution.ok) {
        throw new Error(execution.output);
      }

      const response = parseOutput<BooleanResponse>(execution.output);

      expect(response.success).toBe(true);

      const memories = await manager.getSummary();

      expect(memories).toHaveLength(1);
      expect(memories[0]).toMatchObject({
        id: added.memoryId,
        content: "用户喜欢 TypeScript",
        importance: 0.9,
        metadata: {
          corrected: true,
        },
      });
    });

    it("未提供 memoryId 时参数校验失败", async () => {
      const { registry } = createSubject();

      const execution = await registry.executeDetailed("memory", {
        action: "update",
        content: "更新后的内容",
      });

      expect(execution.ok).toBe(false);

      if (execution.ok) {
        throw new Error("update 缺少 memoryId 时不应该执行成功");
      }

      expect(execution.output).toContain("参数不合法");
      expect(execution.error).toContain("update 操作需要 memoryId");
    });

    it("没有提供任何更新字段时返回工具执行失败", async () => {
      const { registry } = createSubject();

      const addOutput = await registry.execute("memory", {
        action: "add",
        content: "等待更新的记忆",
        memoryType: "working",
      });

      const added = parseOutput<AddResponse>(addOutput);

      /*
       * memoryId 满足 MemoryTool 的输入结构，
       * 但 MemoryManager 会拒绝没有任何更新字段的操作。
       *
       * 这个测试验证 ToolRegistry 能捕获底层异常，并转换为失败结果。
       */
      const execution = await registry.executeDetailed("memory", {
        action: "update",
        memoryId: added.memoryId,
      });

      expect(execution.ok).toBe(false);

      if (execution.ok) {
        throw new Error("没有更新字段时不应该执行成功");
      }

      expect(execution.output).toContain("更新记忆");
      expect(execution.error).toContain("至少需要提供一个字段");
    });
  });

  describe("remove", () => {
    it("可以删除指定记忆", async () => {
      const { manager, registry } = createSubject();

      const addOutput = await registry.execute("memory", {
        action: "add",
        content: "准备删除的记忆",
        memoryType: "working",
      });

      const added = parseOutput<AddResponse>(addOutput);

      const output = await registry.execute("memory", {
        action: "remove",
        memoryId: added.memoryId,
      });

      const response = parseOutput<BooleanResponse>(output);

      expect(response.success).toBe(true);

      const memories = await manager.getSummary();

      expect(memories).toHaveLength(0);
    });

    it("删除不存在的记忆时 success 为 false", async () => {
      const { registry } = createSubject();

      const output = await registry.execute("memory", {
        action: "remove",
        memoryId: "not-exists",
      });

      const response = parseOutput<BooleanResponse>(output);

      expect(response.success).toBe(false);
    });

    it("未提供 memoryId 时参数校验失败", async () => {
      const { registry } = createSubject();

      const execution = await registry.executeDetailed("memory", {
        action: "remove",
      });

      expect(execution.ok).toBe(false);

      if (execution.ok) {
        throw new Error("remove 缺少 memoryId 时不应该执行成功");
      }

      expect(execution.error).toContain("remove 操作需要 memoryId");
    });
  });

  describe("summary", () => {
    it("可以获得按重要性排序的记忆摘要", async () => {
      const { registry } = createSubject();

      await registry.execute("memory", {
        action: "add",
        content: "低重要性记忆",
        memoryType: "working",
        importance: 0.2,
      });

      await registry.execute("memory", {
        action: "add",
        content: "高重要性记忆",
        memoryType: "episodic",
        importance: 0.9,
      });

      const output = await registry.execute("memory", {
        action: "summary",
        limit: 1,
      });

      const response = parseOutput<SummaryResponse>(output);

      expect(response.success).toBe(true);
      expect(response.memories).toHaveLength(1);
      expect(response.memories[0]?.content).toBe("高重要性记忆");
      expect(response.memories[0]?.importance).toBe(0.9);
    });

    it("可以汇总不同类型的记忆", async () => {
      const { registry } = createSubject();

      const memoryTypes: MemoryType[] = ["working", "semantic"];

      for (const memoryType of memoryTypes) {
        await registry.execute("memory", {
          action: "add",
          content: `${memoryType} 类型记忆`,
          memoryType,
          importance: 0.8,
        });
      }

      const output = await registry.execute("memory", {
        action: "summary",
      });

      const response = parseOutput<SummaryResponse>(output);

      expect(response.memories).toHaveLength(2);
      expect(response.memories.map((item) => item.memoryType)).toEqual(
        expect.arrayContaining(["working", "semantic"]),
      );
    });
  });

  describe("stats", () => {
    it("可以返回各类型记忆的统计信息", async () => {
      const { registry } = createSubject();

      await registry.execute("memory", {
        action: "add",
        content: "工作记忆",
        memoryType: "working",
      });

      await registry.execute("memory", {
        action: "add",
        content: "情景记忆",
        memoryType: "episodic",
      });

      await registry.execute("memory", {
        action: "add",
        content: "语义记忆",
        memoryType: "semantic",
      });

      const output = await registry.execute("memory", {
        action: "stats",
      });

      const response = parseOutput<StatsResponse>(output);

      expect(response.success).toBe(true);
      expect(response.stats.totalMemories).toBe(3);
      expect(response.stats.memoriesByType).toMatchObject({
        working: { count: 1 },
        episodic: { count: 1 },
        semantic: { count: 1 },
      });
    });
  });

  describe("forget", () => {
    it("可以按照 importance 策略遗忘低重要性记忆", async () => {
      const { manager, registry } = createSubject();

      await registry.execute("memory", {
        action: "add",
        content: "可以遗忘的低重要性记忆",
        memoryType: "working",
        importance: 0.2,
      });

      await registry.execute("memory", {
        action: "add",
        content: "需要保留的高重要性记忆",
        memoryType: "working",
        importance: 0.9,
      });

      const output = await registry.execute("memory", {
        action: "forget",
        strategy: "importance_based",
        threshold: 0.5,
      });

      const response = parseOutput<ForgetResponse>(output);

      expect(response.success).toBe(true);
      expect(response.forgottenCount).toBe(1);

      const memories = await manager.getSummary();

      expect(memories).toHaveLength(1);
      expect(memories[0]?.content).toBe("需要保留的高重要性记忆");
    });
  });

  describe("consolidate", () => {
    it("可以把高重要性工作记忆巩固为情景记忆", async () => {
      const { manager, registry } = createSubject();

      const addOutput = await registry.execute("memory", {
        action: "add",
        content: "这是一条需要长期保存的重要经历",
        memoryType: "working",
        importance: 0.95,
        metadata: {
          source: "conversation",
        },
      });

      const added = parseOutput<AddResponse>(addOutput);

      const output = await registry.execute("memory", {
        action: "consolidate",
        fromType: "working",
        toType: "episodic",
        importanceThreshold: 0.8,
      });

      const response = parseOutput<ConsolidateResponse>(output);

      expect(response.success).toBe(true);
      expect(response.consolidatedCount).toBe(1);

      const summary = await manager.getSummary();
      const workingMemories = summary.filter(
        (item) => item.memoryType === "working",
      );
      const episodicMemories = summary.filter(
        (item) => item.memoryType === "episodic",
      );

      expect(workingMemories).toHaveLength(0);
      expect(episodicMemories).toHaveLength(1);

      expect(episodicMemories[0]).toMatchObject({
        content: "这是一条需要长期保存的重要经历",
        memoryType: "episodic",
        importance: 1,
        metadata: {
          source: "conversation",
          consolidatedFrom: added.memoryId,
        },
      });

      // 巩固后生成的是一条新的长期记忆，因此 ID 应发生变化。
      expect(episodicMemories[0]?.id).not.toBe(added.memoryId);
    });
  });

  describe("clear", () => {
    it("未显式确认时拒绝清空所有记忆", async () => {
      const { manager, registry } = createSubject();

      await registry.execute("memory", {
        action: "add",
        content: "不能被意外清空的记忆",
        memoryType: "working",
      });

      const execution = await registry.executeDetailed("memory", {
        action: "clear",
      });

      expect(execution.ok).toBe(false);

      if (execution.ok) {
        throw new Error("clear 未确认时不应该执行成功");
      }

      expect(execution.output).toContain("参数不合法");
      expect(execution.error).toContain("confirm");

      // 参数校验失败后，原有数据必须仍然存在。
      const memories = await manager.getSummary();

      expect(memories).toHaveLength(1);
    });

    it("confirm 为 false 时同样拒绝清空", async () => {
      const { manager, registry } = createSubject();

      await registry.execute("memory", {
        action: "add",
        content: "需要保留的记忆",
        memoryType: "working",
      });

      const execution = await registry.executeDetailed("memory", {
        action: "clear",
        confirm: false,
      });

      expect(execution.ok).toBe(false);

      const memories = await manager.getSummary();

      expect(memories).toHaveLength(1);
    });

    it("confirm 为 true 时清空所有记忆", async () => {
      const { manager, registry } = createSubject();

      await registry.execute("memory", {
        action: "add",
        content: "第一条待清空记忆",
        memoryType: "working",
      });

      await registry.execute("memory", {
        action: "add",
        content: "第二条待清空记忆",
        memoryType: "episodic",
      });

      const output = await registry.execute("memory", {
        action: "clear",
        confirm: true,
      });

      const response = parseOutput<BooleanResponse>(output);

      expect(response.success).toBe(true);

      const memories = await manager.getSummary();

      expect(memories).toHaveLength(0);
    });
  });

  describe("ToolRegistry 错误处理", () => {
    it("调用不存在的工具时返回失败结果", async () => {
      const { registry } = createSubject();

      const execution = await registry.executeDetailed("unknown-tool", {
        action: "stats",
      });

      expect(execution.ok).toBe(false);

      if (execution.ok) {
        throw new Error("不存在的工具不应该执行成功");
      }

      expect(execution.output).toContain("unknown-tool");
    });

    it("传入未知 action 时返回参数校验失败", async () => {
      const { registry } = createSubject();

      const execution = await registry.executeDetailed("memory", {
        action: "unknown-action",
      });

      expect(execution.ok).toBe(false);

      if (execution.ok) {
        throw new Error("未知 action 不应该执行成功");
      }

      expect(execution.output).toContain("参数不合法");
    });
  });
});
