import { describe, expect, it } from "vitest";

import { createInMemoryMemoryManager } from "../src/memory/create-in-memory-manager.js";

describe("MemoryManager", () => {
  it("能够创建用户级记忆管理器并启用四种记忆", () => {
    const manager = createInMemoryMemoryManager({
      userId: "user-1",
    });

    expect(manager.getUserId()).toBe("user-1");

    expect(manager.getEnabledTypes()).toEqual([
      "working",
      "episodic",
      "semantic",
      "perceptual",
    ]);
  });

  it("拒绝空 userId", () => {
    expect(() => {
      createInMemoryMemoryManager({
        userId: "   ",
      });
    }).toThrow("MemoryManager userId 不能为空");
  });

  it("显式指定的记忆类型优先于自动分类", async () => {
    const manager = createInMemoryMemoryManager({
      userId: "user-1",
    });

    const memoryId = await manager.addMemory({
      content: "今天完成了 TypeScript Agent 示例",
      memoryType: "semantic",
      importance: 0.8,
    });

    const summary = await manager.getSummary();

    const stored = summary.find((item) => item.id === memoryId);

    expect(stored).toBeDefined();

    /*
     * 内容中的“今天”和“完成”原本会被自动识别为 episodic，
     * 但调用方显式指定了 semantic，因此必须以显式类型为准。
     */
    expect(stored?.memoryType).toBe("semantic");
  });

  it("可以自动分类四种记忆", async () => {
    const manager = createInMemoryMemoryManager({
      userId: "user-1",
    });

    const workingId = await manager.addMemory({
      content: "当前正在讨论 TypeScript",
    });

    const episodicId = await manager.addMemory({
      content: "今天完成了第一个 Agent 示例",
    });

    const semanticId = await manager.addMemory({
      content: "TypeScript是一种编程语言",
    });

    const perceptualId = await manager.addMemory({
      content: "一张 TypeScript 代码截图",
      metadata: {
        modality: "image",
        resourcePath: "/uploads/typescript.png",
      },
    });

    const summary = await manager.getSummary(10);

    const typeById = new Map(summary.map((item) => [item.id, item.memoryType]));

    expect(typeById.get(workingId)).toBe("working");
    expect(typeById.get(episodicId)).toBe("episodic");
    expect(typeById.get(semanticId)).toBe("semantic");
    expect(typeById.get(perceptualId)).toBe("perceptual");
  });

  it("关闭自动分类后默认保存为工作记忆", async () => {
    const manager = createInMemoryMemoryManager({
      userId: "user-1",
    });

    const memoryId = await manager.addMemory({
      content: "今天完成了一个重要项目",
      autoClassify: false,
    });

    const summary = await manager.getSummary();

    const stored = summary.find((item) => item.id === memoryId);

    expect(stored?.memoryType).toBe("working");
  });

  it("能够根据内容和元数据自动计算重要性", async () => {
    const manager = createInMemoryMemoryManager({
      userId: "user-1",
    });

    const normalId = await manager.addMemory({
      content: "普通信息",
      memoryType: "working",
    });

    const importantId = await manager.addMemory({
      content: "这是必须记住的重要信息",
      memoryType: "working",
      metadata: {
        priority: "high",
      },
    });

    const summary = await manager.getSummary(10);

    const normal = summary.find((item) => item.id === normalId);

    const important = summary.find((item) => item.id === importantId);

    expect(normal?.importance).toBe(0.5);

    /*
     * 基础值 0.5
     * “必须”或“重要”关键词 +0.2
     * priority=high +0.3
     * 最终限制在 1
     */
    expect(important?.importance).toBe(1);
  });

  it("显式 importance 优先于自动计算", async () => {
    const manager = createInMemoryMemoryManager({
      userId: "user-1",
    });

    const memoryId = await manager.addMemory({
      content: "这是必须记住的重要信息",
      memoryType: "working",
      importance: 0.3,
      metadata: {
        priority: "high",
      },
    });

    const summary = await manager.getSummary();

    const stored = summary.find((item) => item.id === memoryId);

    expect(stored?.importance).toBe(0.3);
  });

  it("跨类型检索会合并结果并按照 score 降序排列", async () => {
    const manager = createInMemoryMemoryManager({
      userId: "user-1",
    });

    await manager.addMemory({
      content: "TypeScript",
      memoryType: "working",
      importance: 0.7,
    });

    await manager.addMemory({
      content: "TypeScript",
      memoryType: "episodic",
      importance: 0.7,
      metadata: {
        sessionId: "session-1",
      },
    });

    await manager.addMemory({
      content: "TypeScript",
      memoryType: "semantic",
      importance: 0.7,
    });

    const results = await manager.retrieveMemories({
      query: "TypeScript",
      memoryTypes: ["working", "episodic", "semantic"],
      limit: 10,
      minImportance: 0,
    });

    expect(results).toHaveLength(3);

    expect(results.map((result) => result.item.memoryType)).toEqual(
      expect.arrayContaining(["working", "episodic", "semantic"]),
    );

    for (let index = 1; index < results.length; index += 1) {
      const previous = results[index - 1];
      const current = results[index];

      expect(previous?.score).toBeGreaterThanOrEqual(current?.score ?? 0);
    }
  });

  it("跨类型检索遵守全局 limit", async () => {
    const manager = createInMemoryMemoryManager({
      userId: "user-1",
    });

    await manager.addMemory({
      content: "TypeScript",
      memoryType: "working",
      importance: 0.7,
    });

    await manager.addMemory({
      content: "TypeScript",
      memoryType: "episodic",
      importance: 0.7,
    });

    await manager.addMemory({
      content: "TypeScript",
      memoryType: "semantic",
      importance: 0.7,
    });

    const results = await manager.retrieveMemories({
      query: "TypeScript",
      limit: 2,
      minImportance: 0,
    });

    expect(results).toHaveLength(2);
  });

  it("可以更新记忆内容、重要性和元数据", async () => {
    const manager = createInMemoryMemoryManager({
      userId: "user-1",
    });

    const memoryId = await manager.addMemory({
      content: "用户正在学习 JavaScript",
      memoryType: "working",
      importance: 0.5,
    });

    const updated = await manager.updateMemory(memoryId, {
      content: "用户正在学习 TypeScript",
      importance: 0.9,
      metadata: {
        topic: "TypeScript",
      },
    });

    expect(updated).toBe(true);

    const summary = await manager.getSummary();

    const stored = summary.find((item) => item.id === memoryId);

    expect(stored?.content).toBe("用户正在学习 TypeScript");

    expect(stored?.importance).toBe(0.9);
    expect(stored?.metadata.topic).toBe("TypeScript");

    const results = await manager.retrieveMemories({
      query: "TypeScript",
      memoryTypes: ["working"],
      minImportance: 0,
    });

    expect(results[0]?.item.id).toBe(memoryId);
  });

  it("更新不存在的记忆时返回 false", async () => {
    const manager = createInMemoryMemoryManager({
      userId: "user-1",
    });

    const updated = await manager.updateMemory("missing-memory", {
      content: "新内容",
    });

    expect(updated).toBe(false);
  });

  it("更新时至少需要提供一个字段", async () => {
    const manager = createInMemoryMemoryManager({
      userId: "user-1",
    });

    const memoryId = await manager.addMemory({
      content: "测试记忆",
      memoryType: "working",
    });

    await expect(manager.updateMemory(memoryId, {})).rejects.toThrow(
      "更新记忆时至少需要提供一个字段",
    );
  });

  it("可以删除记忆", async () => {
    const manager = createInMemoryMemoryManager({
      userId: "user-1",
    });

    const memoryId = await manager.addMemory({
      content: "待删除的 TypeScript 记忆",
      memoryType: "working",
    });

    expect(await manager.removeMemory(memoryId)).toBe(true);

    expect(await manager.removeMemory(memoryId)).toBe(false);

    const summary = await manager.getSummary();

    expect(summary.some((item) => item.id === memoryId)).toBe(false);
  });

  it("可以按照重要性遗忘低重要性记忆", async () => {
    const manager = createInMemoryMemoryManager({
      userId: "user-1",
    });

    const lowImportanceId = await manager.addMemory({
      content: "低重要性记忆",
      memoryType: "working",
      importance: 0.1,
    });

    const highImportanceId = await manager.addMemory({
      content: "高重要性记忆",
      memoryType: "working",
      importance: 0.9,
    });

    const forgottenCount = await manager.forgetMemories({
      strategy: "importance_based",
      threshold: 0.5,
    });

    expect(forgottenCount).toBe(1);

    const summary = await manager.getSummary();

    expect(summary.some((item) => item.id === lowImportanceId)).toBe(false);

    expect(summary.some((item) => item.id === highImportanceId)).toBe(true);
  });

  it("可以按照时间遗忘过期的长期记忆", async () => {
    let currentTime = new Date("2026-07-01T10:00:00.000Z");

    const manager = createInMemoryMemoryManager({
      userId: "user-1",
      now: () => currentTime,
    });

    const oldMemoryId = await manager.addMemory({
      content: "很久以前完成了一个项目",
      memoryType: "episodic",
      importance: 0.8,
    });

    /*
     * 推进到 40 天以后。
     *
     * 使用情景记忆而不是工作记忆，是为了避免工作记忆
     * 自身的 TTL 在遗忘操作之前就将数据删除。
     */
    currentTime = new Date("2026-08-10T10:00:00.000Z");

    const forgottenCount = await manager.forgetMemories({
      strategy: "time_based",
      maxAgeDays: 30,
    });

    expect(forgottenCount).toBe(1);

    const summary = await manager.getSummary();

    expect(summary.some((item) => item.id === oldMemoryId)).toBe(false);
  });

  it("time_based 遗忘拒绝非法 maxAgeDays", async () => {
    const manager = createInMemoryMemoryManager({
      userId: "user-1",
    });

    await expect(
      manager.forgetMemories({
        strategy: "time_based",
        maxAgeDays: 0,
      }),
    ).rejects.toThrow("maxAgeDays 必须大于 0");
  });

  it("可以按照长期记忆容量遗忘最低保留分数的记忆", async () => {
    const manager = createInMemoryMemoryManager({
      userId: "user-1",
      config: {
        longTermMemoryCapacity: 2,
      },
    });

    const lowId = await manager.addMemory({
      content: "低优先级语义知识",
      memoryType: "semantic",
      importance: 0.1,
    });

    const mediumId = await manager.addMemory({
      content: "中优先级语义知识",
      memoryType: "semantic",
      importance: 0.5,
    });

    const highId = await manager.addMemory({
      content: "高优先级语义知识",
      memoryType: "semantic",
      importance: 0.9,
    });

    const forgottenCount = await manager.forgetMemories({
      strategy: "capacity_based",
    });

    expect(forgottenCount).toBe(1);

    const summary = await manager.getSummary(10);
    const remainingIds = summary.map((item) => item.id);

    expect(remainingIds).not.toContain(lowId);
    expect(remainingIds).toContain(mediumId);
    expect(remainingIds).toContain(highId);
  });

  it("可以把高重要性工作记忆整合为情景记忆", async () => {
    const now = new Date("2026-08-18T12:00:00.000Z");

    const manager = createInMemoryMemoryManager({
      userId: "user-1",
      now: () => now,
    });

    const sourceId = await manager.addMemory({
      content: "用户完成了重要的 TypeScript 项目",
      memoryType: "working",
      importance: 0.9,
      metadata: {
        sessionId: "session-1",
      },
    });

    const consolidatedCount = await manager.consolidateMemories({
      fromType: "working",
      toType: "episodic",
      importanceThreshold: 0.7,
    });

    expect(consolidatedCount).toBe(1);

    const summary = await manager.getSummary(10);

    expect(summary.some((item) => item.id === sourceId)).toBe(false);

    const consolidated = summary.find(
      (item) => item.metadata.consolidatedFrom === sourceId,
    );

    expect(consolidated).toBeDefined();
    expect(consolidated?.memoryType).toBe("episodic");
    expect(consolidated?.importance).toBeCloseTo(0.99);
    expect(consolidated?.metadata.previousMemoryType).toBe("working");
  });

  it("整合时不会移动低于重要性阈值的记忆", async () => {
    const manager = createInMemoryMemoryManager({
      userId: "user-1",
    });

    const sourceId = await manager.addMemory({
      content: "普通的临时信息",
      memoryType: "working",
      importance: 0.4,
    });

    const consolidatedCount = await manager.consolidateMemories({
      fromType: "working",
      toType: "episodic",
      importanceThreshold: 0.7,
    });

    expect(consolidatedCount).toBe(0);

    const summary = await manager.getSummary();

    const source = summary.find((item) => item.id === sourceId);

    expect(source?.memoryType).toBe("working");
  });

  it("源类型和目标类型相同时拒绝整合", async () => {
    const manager = createInMemoryMemoryManager({
      userId: "user-1",
    });

    await expect(
      manager.consolidateMemories({
        fromType: "working",
        toType: "working",
        importanceThreshold: 0.7,
      }),
    ).rejects.toThrow("源记忆类型和目标记忆类型不能相同");
  });

  it("可以获取各类型统计信息", async () => {
    const manager = createInMemoryMemoryManager({
      userId: "user-1",
    });

    await manager.addMemory({
      content: "工作记忆",
      memoryType: "working",
      importance: 0.5,
    });

    await manager.addMemory({
      content: "今天完成了项目",
      memoryType: "episodic",
      importance: 0.8,
    });

    await manager.addMemory({
      content: "TypeScript属于JavaScript",
      memoryType: "semantic",
      importance: 0.9,
    });

    const stats = await manager.getStats();

    expect(stats.userId).toBe("user-1");
    expect(stats.totalMemories).toBe(3);

    expect(stats.memoriesByType.working?.count).toBe(1);

    expect(stats.memoriesByType.episodic?.count).toBe(1);

    expect(stats.memoriesByType.semantic?.count).toBe(1);

    expect(stats.memoriesByType.perceptual?.count).toBe(0);
  });

  it("摘要按照重要性降序排列并遵守 limit", async () => {
    const manager = createInMemoryMemoryManager({
      userId: "user-1",
    });

    await manager.addMemory({
      content: "低重要性",
      memoryType: "working",
      importance: 0.2,
    });

    await manager.addMemory({
      content: "高重要性",
      memoryType: "episodic",
      importance: 0.9,
    });

    await manager.addMemory({
      content: "中重要性",
      memoryType: "semantic",
      importance: 0.5,
    });

    const summary = await manager.getSummary(2);

    expect(summary).toHaveLength(2);
    expect(summary[0]?.importance).toBe(0.9);
    expect(summary[1]?.importance).toBe(0.5);
  });

  it("可以清空当前用户的全部记忆", async () => {
    const manager = createInMemoryMemoryManager({
      userId: "user-1",
    });

    await manager.addMemory({
      content: "工作记忆",
      memoryType: "working",
    });

    await manager.addMemory({
      content: "今天完成了项目",
      memoryType: "episodic",
    });

    await manager.addMemory({
      content: "TypeScript属于JavaScript",
      memoryType: "semantic",
    });

    await manager.addMemory({
      content: "一张 TypeScript 截图",
      memoryType: "perceptual",
      metadata: {
        modality: "image",
      },
    });

    await manager.clearAllMemories();

    expect(await manager.getSummary()).toEqual([]);

    const stats = await manager.getStats();

    expect(stats.totalMemories).toBe(0);
    expect(stats.memoriesByType.working?.count).toBe(0);
    expect(stats.memoriesByType.episodic?.count).toBe(0);
    expect(stats.memoriesByType.semantic?.count).toBe(0);
    expect(stats.memoriesByType.perceptual?.count).toBe(0);
  });

  it("拒绝空的添加内容和检索查询", async () => {
    const manager = createInMemoryMemoryManager({
      userId: "user-1",
    });

    await expect(
      manager.addMemory({
        content: "   ",
      }),
    ).rejects.toThrow();

    await expect(
      manager.retrieveMemories({
        query: "   ",
      }),
    ).rejects.toThrow();
  });
});
