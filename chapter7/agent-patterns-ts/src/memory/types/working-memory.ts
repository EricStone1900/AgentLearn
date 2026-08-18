import {
  BaseMemory,
  type MemorySearchOptions,
  type MemoryStats,
  type UpdateMemoryInput,
} from "../base.js";
import {
  importanceWeight,
  lexicalSimilarity,
  recencyScore,
} from "../scoring.js";
import { memoryItemSchema } from "../schemas.js";
import type {
  MemoryConfig,
  MemoryItem,
  MemorySearchResult,
} from "../schemas.js";

export class WorkingMemory extends BaseMemory {
  public readonly type = "working" as const;

  private readonly items = new Map<string, MemoryItem>();

  public constructor(
    private readonly config: MemoryConfig,
    private readonly now: () => Date = () => new Date(),
  ) {
    super();
  }

  public async add(item: MemoryItem): Promise<string> {
    const parsed = memoryItemSchema.parse(item);

    if (parsed.memoryType !== this.type) {
      throw new Error(`WorkingMemory 不能保存 ${parsed.memoryType} 记忆`);
    }

    this.expireOldItems();

    if (!this.items.has(parsed.id)) {
      this.enforceCapacity();
    }

    this.items.set(parsed.id, structuredClone(parsed));
    return parsed.id;
  }

  public async retrieve(
    query: string,
    options: MemorySearchOptions = {},
  ): Promise<MemorySearchResult[]> {
    const normalizedQuery = query.trim();

    if (!normalizedQuery) {
      throw new Error("记忆查询不能为空");
    }

    this.expireOldItems();

    const limit = options.limit ?? this.config.defaultSearchLimit;
    const minImportance =
      options.minImportance ?? this.config.importanceThreshold;

    const results: MemorySearchResult[] = [];

    for (const item of this.items.values()) {
      if (options.userId && item.userId !== options.userId) continue;
      if (item.importance < minImportance) continue;
      if (options.startTime && item.timestamp < options.startTime) continue;
      if (options.endTime && item.timestamp > options.endTime) continue;

      const lexical = lexicalSimilarity(normalizedQuery, item.content);
      if (lexical === 0) continue;

      const recency = recencyScore(item.timestamp, this.now());
      const score = lexical * recency * importanceWeight(item.importance);

      results.push({
        item: structuredClone(item),
        score,
        signals: {
          relevance: lexical,
          lexical,
          recency,
          importance: item.importance,
        },
      });
    }

    return results
      .sort((left, right) => right.score - left.score)
      .slice(0, limit);
  }

  public async update(
    memoryId: string,
    input: UpdateMemoryInput,
  ): Promise<boolean> {
    const current = this.items.get(memoryId);
    if (!current) return false;

    const updated = memoryItemSchema.parse({
      ...current,
      ...(input.content === undefined ? {} : { content: input.content }),
      ...(input.importance === undefined
        ? {}
        : { importance: input.importance }),
      metadata: {
        ...current.metadata,
        ...(input.metadata ?? {}),
      },
    });

    this.items.set(memoryId, updated);
    return true;
  }

  public async remove(memoryId: string): Promise<boolean> {
    return this.items.delete(memoryId);
  }

  public async has(memoryId: string): Promise<boolean> {
    this.expireOldItems();
    return this.items.has(memoryId);
  }

  public async getAll(userId?: string): Promise<MemoryItem[]> {
    this.expireOldItems();
    return [...this.items.values()]
      .filter((item) => !userId || item.userId === userId)
      .map((item) => structuredClone(item));
  }

  public async clear(userId?: string): Promise<void> {
    if (!userId) {
      this.items.clear();
      return;
    }

    for (const [id, item] of this.items) {
      if (item.userId === userId) this.items.delete(id);
    }
  }

  public async stats(userId?: string): Promise<MemoryStats> {
    const items = await this.getAll(userId);
    const total = items.reduce((sum, item) => sum + item.importance, 0);

    return {
      type: this.type,
      count: items.length,
      averageImportance: items.length === 0 ? 0 : total / items.length,
    };
  }

  private expireOldItems(): void {
    const nowMs = this.now().getTime();

    for (const [id, item] of this.items) {
      if (nowMs - Date.parse(item.timestamp) > this.config.workingMemoryTtlMs) {
        this.items.delete(id);
      }
    }
  }

  private enforceCapacity(): void {
    while (this.items.size >= this.config.workingMemoryCapacity) {
      let lowest: MemoryItem | undefined;

      for (const item of this.items.values()) {
        if (
          !lowest ||
          this.calculatePriority(item) < this.calculatePriority(lowest)
        ) {
          lowest = item;
        }
      }

      if (!lowest) return;
      this.items.delete(lowest.id);
    }
  }

  private calculatePriority(item: MemoryItem): number {
    return (
      item.importance * 0.7 + recencyScore(item.timestamp, this.now()) * 0.3
    );
  }
}
