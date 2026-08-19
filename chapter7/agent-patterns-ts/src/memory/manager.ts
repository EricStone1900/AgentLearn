import { randomUUID } from "node:crypto";
import type {
  BaseMemory,
  MemoryStats,
  UpdateMemoryInput,
} from "./base.js";
import { recencyScore } from "./scoring.js";
import {
  addMemoryInputSchema,
  consolidateMemoryInputSchema,
  memoryItemSchema,
  retrieveMemoriesInputSchema,
} from "./schemas.js";
import type {
  AddMemoryInput,
  ConsolidateMemoryInput,
  ForgetStrategy,
  MemoryConfig,
  MemoryItem,
  MemorySearchResult,
  MemoryType,
  RetrieveMemoriesInput,
} from "./schemas.js";

export interface ForgetMemoriesInput {
  strategy: ForgetStrategy;
  threshold?: number;
  maxAgeDays?: number;
}

export interface MemoryManagerStats {
  userId: string;
  totalMemories: number;
  memoriesByType: Partial<Record<MemoryType, MemoryStats>>;
}

export class MemoryManager {
  private readonly memories = new Map<MemoryType, BaseMemory>();
  private readonly userId: string;

  public constructor(
    userId: string,
    memoryImplementations: BaseMemory[],
    private readonly config: MemoryConfig,
    private readonly now: () => Date = () => new Date(),
  ) {
    const normalizedUserId = userId.trim();
    if (!normalizedUserId) throw new Error("MemoryManager userId 不能为空");
    if (memoryImplementations.length === 0) {
      throw new Error("MemoryManager 至少需要一种记忆实现");
    }

    this.userId = normalizedUserId;

    for (const memory of memoryImplementations) {
      if (this.memories.has(memory.type)) {
        throw new Error(`重复注册记忆类型：${memory.type}`);
      }
      this.memories.set(memory.type, memory);
    }
  }

  public getUserId(): string {
    return this.userId;
  }

  public getEnabledTypes(): MemoryType[] {
    return [...this.memories.keys()];
  }

  public async addMemory(input: AddMemoryInput): Promise<string> {
    const parsed = addMemoryInputSchema.parse(input);
    const metadata = parsed.metadata ?? {};
    const memoryType =
      parsed.memoryType ??
      (parsed.autoClassify
        ? this.classifyMemoryType(parsed.content, metadata)
        : "working");
    const importance =
      parsed.importance ?? this.calculateImportance(parsed.content, metadata);
    const memory = this.requireMemory(memoryType);

    const item = memoryItemSchema.parse({
      id: randomUUID(),
      content: parsed.content,
      memoryType,
      userId: this.userId,
      timestamp: this.now().toISOString(),
      importance,
      metadata,
    });

    return memory.add(item);
  }

  public async retrieveMemories(
    input: RetrieveMemoriesInput,
  ): Promise<MemorySearchResult[]> {
    const parsed = retrieveMemoriesInputSchema.parse(input);
    const limit = parsed.limit ?? this.config.defaultSearchLimit;
    const requestedTypes = parsed.memoryTypes ?? this.getEnabledTypes();
    const candidateLimit = Math.max(limit * 2, 10);

    const searches = requestedTypes.map((memoryType) => {
      const memory = this.requireMemory(memoryType);

      return memory.retrieve(parsed.query, {
        userId: this.userId,
        limit: candidateLimit,
        minImportance:
          parsed.minImportance ?? this.config.importanceThreshold,
        ...(parsed.startTime ? { startTime: parsed.startTime } : {}),
        ...(parsed.endTime ? { endTime: parsed.endTime } : {}),
      });
    });

    const groups = await Promise.all(searches);
    const deduplicated = new Map<string, MemorySearchResult>();

    for (const result of groups.flat()) {
      const current = deduplicated.get(result.item.id);
      if (!current || result.score > current.score) {
        deduplicated.set(result.item.id, result);
      }
    }

    return [...deduplicated.values()]
      .sort((left, right) => right.score - left.score)
      .slice(0, limit);
  }

  public async updateMemory(
    memoryId: string,
    input: UpdateMemoryInput,
  ): Promise<boolean> {
    const normalizedId = memoryId.trim();
    if (!normalizedId) throw new Error("memoryId 不能为空");
    if (
      input.content === undefined &&
      input.importance === undefined &&
      input.metadata === undefined
    ) {
      throw new Error("更新记忆时至少需要提供一个字段");
    }
    if (input.content !== undefined && !input.content.trim()) {
      throw new Error("记忆内容不能为空");
    }
    if (
      input.importance !== undefined &&
      (input.importance < 0 || input.importance > 1)
    ) {
      throw new Error("importance 必须在 0 到 1 之间");
    }

    for (const memory of this.memories.values()) {
      if (await memory.has(normalizedId)) {
        return memory.update(normalizedId, input);
      }
    }

    return false;
  }

  public async removeMemory(memoryId: string): Promise<boolean> {
    const normalizedId = memoryId.trim();
    if (!normalizedId) throw new Error("memoryId 不能为空");

    for (const memory of this.memories.values()) {
      if (await memory.has(normalizedId)) return memory.remove(normalizedId);
    }

    return false;
  }

  public async forgetMemories(input: ForgetMemoriesInput): Promise<number> {
    let removedCount = 0;

    for (const memory of this.memories.values()) {
      const items = await memory.getAll(this.userId);
      let candidates: MemoryItem[] = [];

      switch (input.strategy) {
        case "importance_based": {
          const threshold = input.threshold ?? this.config.importanceThreshold;
          candidates = items.filter((item) => item.importance < threshold);
          break;
        }

        case "time_based": {
          const maxAgeDays = input.maxAgeDays ?? 30;
          if (maxAgeDays <= 0) throw new Error("maxAgeDays 必须大于 0");
          const cutoff = this.now().getTime() - maxAgeDays * 86_400_000;
          candidates = items.filter(
            (item) => Date.parse(item.timestamp) < cutoff,
          );
          break;
        }

        case "capacity_based": {
          const capacity =
            memory.type === "working"
              ? this.config.workingMemoryCapacity
              : this.config.longTermMemoryCapacity;
          const excess = Math.max(0, items.length - capacity);
          candidates = [...items]
            .sort((left, right) => {
              const leftScore =
                left.importance * 0.7 +
                recencyScore(left.timestamp, this.now()) * 0.3;
              const rightScore =
                right.importance * 0.7 +
                recencyScore(right.timestamp, this.now()) * 0.3;
              return leftScore - rightScore;
            })
            .slice(0, excess);
          break;
        }
      }

      for (const item of candidates) {
        if (await memory.remove(item.id)) removedCount += 1;
      }
    }

    return removedCount;
  }

  public async consolidateMemories(
    input: ConsolidateMemoryInput,
  ): Promise<number> {
    const parsed = consolidateMemoryInputSchema.parse(input);
    const source = this.requireMemory(parsed.fromType);
    const target = this.requireMemory(parsed.toType);
    const items = await source.getAll(this.userId);
    const candidates = items.filter(
      (item) => item.importance >= parsed.importanceThreshold,
    );
    let count = 0;

    for (const item of candidates) {
      const consolidated = memoryItemSchema.parse({
        ...item,
        id: randomUUID(),
        memoryType: parsed.toType,
        importance: Math.min(1, item.importance * 1.1),
        timestamp: this.now().toISOString(),
        metadata: {
          ...item.metadata,
          consolidatedFrom: item.id,
          previousMemoryType: item.memoryType,
        },
      });

      await target.add(consolidated);
      const removed = await source.remove(item.id);

      if (!removed) {
        // 源删除失败时回滚刚写入的目标记忆。
        await target.remove(consolidated.id);
        throw new Error(`整合失败，无法删除源记忆：${item.id}`);
      }

      count += 1;
    }

    return count;
  }

  public async getSummary(limit = 10): Promise<MemoryItem[]> {
    const groups = await Promise.all(
      [...this.memories.values()].map((memory) => memory.getAll(this.userId)),
    );

    return groups
      .flat()
      .sort((left, right) => {
        if (right.importance !== left.importance) {
          return right.importance - left.importance;
        }
        return right.timestamp.localeCompare(left.timestamp);
      })
      .slice(0, limit);
  }

  public async getStats(): Promise<MemoryManagerStats> {
    const entries = await Promise.all(
      [...this.memories.entries()].map(async ([type, memory]) => {
        return [type, await memory.stats(this.userId)] as const;
      }),
    );
    const memoriesByType: Partial<Record<MemoryType, MemoryStats>> = {};
    let totalMemories = 0;

    for (const [type, stats] of entries) {
      memoriesByType[type] = stats;
      totalMemories += stats.count;
    }

    return {
      userId: this.userId,
      totalMemories,
      memoriesByType,
    };
  }

  public async clearAllMemories(): Promise<void> {
    await Promise.all(
      [...this.memories.values()].map((memory) => memory.clear(this.userId)),
    );
  }

  private requireMemory(memoryType: MemoryType): BaseMemory {
    const memory = this.memories.get(memoryType);
    if (!memory) throw new Error(`记忆类型没有启用：${memoryType}`);
    return memory;
  }

  private classifyMemoryType(
    content: string,
    metadata: Record<string, unknown>,
  ): MemoryType {
    if (metadata.modality !== undefined) return "perceptual";

    const episodicKeywords = [
      "昨天", "今天", "上次", "发生", "完成", "经历", "会议",
    ];
    if (episodicKeywords.some((keyword) => content.includes(keyword))) {
      return "episodic";
    }

    const semanticKeywords = [
      "定义", "概念", "规则", "知识", "原理", "属于", "是一种",
    ];
    if (semanticKeywords.some((keyword) => content.includes(keyword))) {
      return "semantic";
    }

    return "working";
  }

  private calculateImportance(
    content: string,
    metadata: Record<string, unknown>,
  ): number {
    let importance = 0.5;
    if (content.length > 100) importance += 0.1;

    const importantKeywords = ["重要", "关键", "必须", "注意", "警告", "错误"];
    if (importantKeywords.some((keyword) => content.includes(keyword))) {
      importance += 0.2;
    }

    if (metadata.priority === "high") importance += 0.3;
    if (metadata.priority === "low") importance -= 0.2;

    return Math.min(1, Math.max(0, importance));
  }
}