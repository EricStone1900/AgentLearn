# TypeScript 记忆模块实现教程

> 本教程以 `chapter7/agent-patterns-ts` 为唯一基础项目，对应《第八章 记忆与检索》8.2 节，并参考 `HelloAgents/hello_agents/memory` 的分层设计。
>
> 教程不直接修改项目源代码。请按步骤手工创建或替换文件，每完成一步都执行类型检查和测试。

## 一、最终架构

```text
Agent
  └── MemoryTool
        └── MemoryManager
              ├── WorkingMemory       纯内存、容量、TTL
              ├── EpisodicMemory      文档存储 + 向量检索 + 时间近因性
              ├── SemanticMemory      文档存储 + 向量检索 + 知识图谱
              └── PerceptualMemory    文档存储 + 模态向量检索

基础设施接口
  ├── DocumentStore
  ├── VectorStore
  ├── GraphStore
  ├── EmbeddingClient
  └── KnowledgeExtractor
```

第一阶段使用内存适配器，目标是理解完整记忆生命周期并获得稳定测试。第二阶段再替换为 SQLite、Qdrant、Neo4j 和真实 Embedding 服务。

## 二、Step 0：整理当前未完成骨架

当前 `src/memory` 中存在提前创建但未完成的文件，TypeScript 会同时编译它们，导致每一步都无法独立验收。先把它们移到项目根目录备份：

```bash
cd /Users/huangbosong/Documents/ChatGPT/AgentLearn/chapter7/agent-patterns-ts
mv src/memory memory-draft
mkdir -p src/memory/types src/memory/storage
```

`memory-draft` 不在 `tsconfig.json` 的 `src/**/*.ts` 范围内，因此不会参与编译；原文件仍然保留，可随时比较。

确认原项目恢复正常：

```bash
npm run typecheck
npm test
```

后续不要提前创建未实现的 TypeScript 文件。严格按本教程顺序创建。

## 三、Step 1：领域模型与配置

创建 `src/memory/schemas.ts`：

```ts
import { z } from "zod";

export const memoryTypeSchema = z.enum([
  "working",
  "episodic",
  "semantic",
  "perceptual",
]);

export type MemoryType = z.infer<typeof memoryTypeSchema>;

export const memoryItemSchema = z.object({
  id: z.string().trim().min(1),
  content: z.string().trim().min(1),
  memoryType: memoryTypeSchema,
  userId: z.string().trim().min(1),
  timestamp: z.string().datetime(),
  importance: z.number().min(0).max(1),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export type MemoryItem = z.infer<typeof memoryItemSchema>;

export interface MemoryScoreSignals {
  relevance: number;
  importance: number;
  lexical?: number;
  vector?: number;
  graph?: number;
  recency?: number;
}

export interface MemorySearchResult {
  item: MemoryItem;
  score: number;
  signals: MemoryScoreSignals;
}

export const memoryConfigSchema = z.object({
  workingMemoryCapacity: z.number().int().positive().default(10),
  workingMemoryTtlMs: z.number().int().positive().default(2 * 60 * 60 * 1000),
  longTermMemoryCapacity: z.number().int().positive().default(1000),
  defaultSearchLimit: z.number().int().positive().max(100).default(5),
  importanceThreshold: z.number().min(0).max(1).default(0.1),
  decayFactor: z.number().positive().max(1).default(0.95),
});

export type MemoryConfig = z.infer<typeof memoryConfigSchema>;

export function createDefaultMemoryConfig(): MemoryConfig {
  return memoryConfigSchema.parse({});
}

export const addMemoryInputSchema = z.object({
  content: z.string().trim().min(1),
  memoryType: memoryTypeSchema.optional(),
  importance: z.number().min(0).max(1).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  autoClassify: z.boolean().default(true),
});

export type AddMemoryInput = z.input<typeof addMemoryInputSchema>;

export const retrieveMemoriesInputSchema = z.object({
  query: z.string().trim().min(1),
  memoryTypes: z.array(memoryTypeSchema).min(1).optional(),
  limit: z.number().int().positive().max(100).optional(),
  minImportance: z.number().min(0).max(1).optional(),
  startTime: z.string().datetime().optional(),
  endTime: z.string().datetime().optional(),
});

export type RetrieveMemoriesInput = z.input<
  typeof retrieveMemoriesInputSchema
>;

export const forgetStrategySchema = z.enum([
  "importance_based",
  "time_based",
  "capacity_based",
]);

export type ForgetStrategy = z.infer<typeof forgetStrategySchema>;

export const consolidateMemoryInputSchema = z
  .object({
    fromType: memoryTypeSchema,
    toType: memoryTypeSchema,
    importanceThreshold: z.number().min(0).max(1),
  })
  .refine((input) => input.fromType !== input.toType, {
    message: "源记忆类型和目标记忆类型不能相同",
    path: ["toType"],
  });

export type ConsolidateMemoryInput = z.infer<
  typeof consolidateMemoryInputSchema
>;
```

关键点：

- Zod 对应 Python 版 Pydantic，负责运行时校验。
- 时间戳使用 ISO 字符串，方便 JSON 和数据库持久化。
- `MemorySearchResult` 保留最终分数，避免跨类型合并时只按重要性排序。
- `z.input` 表示调用方输入，因此带默认值的字段仍可省略。

创建 `tests/memory-schemas.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import {
  addMemoryInputSchema,
  createDefaultMemoryConfig,
  memoryItemSchema,
} from "../src/memory/schemas.js";

describe("memory schemas", () => {
  it("解析合法记忆", () => {
    const item = memoryItemSchema.parse({
      id: "m-1",
      content: "  用户正在学习 TypeScript  ",
      memoryType: "semantic",
      userId: "u-1",
      timestamp: "2026-08-18T10:00:00.000Z",
      importance: 0.8,
    });

    expect(item.content).toBe("用户正在学习 TypeScript");
    expect(item.metadata).toEqual({});
  });

  it("拒绝越界的重要性", () => {
    const result = addMemoryInputSchema.safeParse({
      content: "测试",
      importance: 2,
    });

    expect(result.success).toBe(false);
  });

  it("生成默认配置", () => {
    expect(createDefaultMemoryConfig().workingMemoryCapacity).toBe(10);
  });
});
```

验收：

```bash
npm run typecheck
npm test -- memory-schemas.test.ts
```

## 四、Step 2：统一记忆接口

创建 `src/memory/base.ts`：

```ts
import type {
  MemoryItem,
  MemorySearchResult,
  MemoryType,
} from "./schemas.js";

export interface MemorySearchOptions {
  limit?: number;
  userId?: string;
  minImportance?: number;
  startTime?: string;
  endTime?: string;
}

export interface UpdateMemoryInput {
  content?: string;
  importance?: number;
  metadata?: Record<string, unknown>;
}

export interface MemoryStats {
  type: MemoryType;
  count: number;
  averageImportance: number;
}

export abstract class BaseMemory {
  public abstract readonly type: MemoryType;

  public abstract add(item: MemoryItem): Promise<string>;

  public abstract retrieve(
    query: string,
    options?: MemorySearchOptions,
  ): Promise<MemorySearchResult[]>;

  public abstract update(
    memoryId: string,
    input: UpdateMemoryInput,
  ): Promise<boolean>;

  public abstract remove(memoryId: string): Promise<boolean>;

  public abstract has(memoryId: string): Promise<boolean>;

  public abstract getAll(userId?: string): Promise<MemoryItem[]>;

  public abstract clear(userId?: string): Promise<void>;

  public abstract stats(userId?: string): Promise<MemoryStats>;
}
```

所有接口使用 `Promise`，因为第二阶段的 SQLite、Qdrant、Neo4j 和网络 Embedding 都是异步操作。

## 五、Step 3：评分算法

创建 `src/memory/scoring.ts`：

```ts
function clamp(value: number, minimum = 0, maximum = 1): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .match(/[\p{Script=Han}]|[\p{Script=Latin}\p{N}_+-]+/gu) ?? [];
}

export function importanceWeight(importance: number): number {
  return 0.8 + clamp(importance) * 0.4;
}

export function recencyScore(
  timestamp: string,
  now: Date = new Date(),
): number {
  const timestampMs = Date.parse(timestamp);

  if (!Number.isFinite(timestampMs)) {
    throw new Error(`非法记忆时间：${timestamp}`);
  }

  const ageMs = Math.max(0, now.getTime() - timestampMs);
  const ageDays = ageMs / (24 * 60 * 60 * 1000);

  return 1 / (1 + ageDays);
}

export function lexicalSimilarity(query: string, content: string): number {
  const queryTokens = new Set(tokenize(query));
  const contentTokens = new Set(tokenize(content));

  if (queryTokens.size === 0 || contentTokens.size === 0) {
    return 0;
  }

  let intersection = 0;

  for (const token of queryTokens) {
    if (contentTokens.has(token)) {
      intersection += 1;
    }
  }

  const union = new Set([...queryTokens, ...contentTokens]).size;

  return union === 0 ? 0 : intersection / union;
}

export function cosineSimilarity(left: number[], right: number[]): number {
  if (left.length !== right.length || left.length === 0) {
    throw new Error("余弦相似度要求两个非空向量维度相同");
  }

  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;

  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;

    dot += leftValue * rightValue;
    leftNorm += leftValue ** 2;
    rightNorm += rightValue ** 2;
  }

  if (leftNorm === 0 || rightNorm === 0) {
    return 0;
  }

  return clamp(dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm)));
}
```

创建 `tests/memory-scoring.test.ts`，验证：重要性 0/1 分别映射为 0.8/1.2；当天记忆近因性为 1；一天前为 0.5；相同文本的词法相似度高于无关文本；正交向量相似度为 0。

## 六、Step 4：工作记忆

创建 `src/memory/types/working-memory.ts`：

```ts
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

    return results.sort((left, right) => right.score - left.score).slice(0, limit);
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
        if (!lowest || this.calculatePriority(item) < this.calculatePriority(lowest)) {
          lowest = item;
        }
      }

      if (!lowest) return;
      this.items.delete(lowest.id);
    }
  }

  private calculatePriority(item: MemoryItem): number {
    return item.importance * 0.7 + recencyScore(item.timestamp, this.now()) * 0.3;
  }
}
```

测试必须覆盖：添加/检索、用户隔离、TTL、容量淘汰、更新、删除、统计。测试时间通过构造函数的 `now` 注入，不使用真实等待。

## 七、Step 5：文档存储

创建 `src/memory/storage/document-store.ts`。该文件第一阶段只实现内存版本，不要提前声明未实现的 SQLite 类。

```ts
import type { MemoryItem, MemoryType } from "../schemas.js";

export interface DocumentFilter {
  userId?: string;
  memoryType?: MemoryType;
  minImportance?: number;
  startTime?: string;
  endTime?: string;
}

export interface DocumentStore {
  add(item: MemoryItem): Promise<void>;
  get(memoryId: string): Promise<MemoryItem | undefined>;
  list(filter?: DocumentFilter): Promise<MemoryItem[]>;
  update(item: MemoryItem): Promise<void>;
  delete(memoryId: string): Promise<boolean>;
  clear(filter?: DocumentFilter): Promise<void>;
}

export class InMemoryDocumentStore implements DocumentStore {
  private readonly items = new Map<string, MemoryItem>();

  public async add(item: MemoryItem): Promise<void> {
    if (this.items.has(item.id)) throw new Error(`记忆已存在：${item.id}`);
    this.items.set(item.id, structuredClone(item));
  }

  public async get(memoryId: string): Promise<MemoryItem | undefined> {
    const item = this.items.get(memoryId);
    return item ? structuredClone(item) : undefined;
  }

  public async list(filter: DocumentFilter = {}): Promise<MemoryItem[]> {
    return [...this.items.values()]
      .filter((item) => !filter.userId || item.userId === filter.userId)
      .filter((item) => !filter.memoryType || item.memoryType === filter.memoryType)
      .filter((item) =>
        filter.minImportance === undefined ||
        item.importance >= filter.minImportance,
      )
      .filter((item) => !filter.startTime || item.timestamp >= filter.startTime)
      .filter((item) => !filter.endTime || item.timestamp <= filter.endTime)
      .map((item) => structuredClone(item));
  }

  public async update(item: MemoryItem): Promise<void> {
    if (!this.items.has(item.id)) throw new Error(`记忆不存在：${item.id}`);
    this.items.set(item.id, structuredClone(item));
  }

  public async delete(memoryId: string): Promise<boolean> {
    return this.items.delete(memoryId);
  }

  public async clear(filter: DocumentFilter = {}): Promise<void> {
    const matches = await this.list(filter);
    for (const item of matches) this.items.delete(item.id);
  }
}
```

## 八、Step 6：哈希嵌入与内存向量库

创建 `src/memory/embedding.ts`：

```ts
export interface EmbeddingClient {
  readonly dimension: number;
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
}

function tokens(text: string): string[] {
  return (
    text
      .toLowerCase()
      .match(/[\p{Script=Han}]|[\p{Script=Latin}\p{N}_+-]+/gu) ?? []
  );
}

function stableHash(value: string): number {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export class HashEmbeddingClient implements EmbeddingClient {
  public constructor(public readonly dimension = 128) {
    if (!Number.isInteger(dimension) || dimension <= 0) {
      throw new Error("向量维度必须是正整数");
    }
  }

  public async embed(text: string): Promise<number[]> {
    const vector = Array<number>(this.dimension).fill(0);

    for (const token of tokens(text)) {
      const index = stableHash(token) % this.dimension;
      vector[index] = (vector[index] ?? 0) + 1;
    }

    const norm = Math.sqrt(vector.reduce((sum, value) => sum + value ** 2, 0));
    return norm === 0 ? vector : vector.map((value) => value / norm);
  }

  public async embedBatch(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map((text) => this.embed(text)));
  }
}
```

创建 `src/memory/storage/vector-store.ts`：

```ts
import { cosineSimilarity } from "../scoring.js";

export interface VectorRecord {
  id: string;
  vector: number[];
  metadata: Record<string, unknown>;
}

export interface VectorSearchFilter {
  userId?: string;
  memoryType?: string;
  modality?: string;
}

export interface VectorHit {
  id: string;
  score: number;
  metadata: Record<string, unknown>;
}

export interface VectorStore {
  upsert(records: VectorRecord[]): Promise<void>;
  search(vector: number[], limit: number, filter?: VectorSearchFilter): Promise<VectorHit[]>;
  delete(ids: string[]): Promise<void>;
  clear(filter?: VectorSearchFilter): Promise<void>;
}

function matches(metadata: Record<string, unknown>, filter: VectorSearchFilter): boolean {
  return (
    (!filter.userId || metadata.userId === filter.userId) &&
    (!filter.memoryType || metadata.memoryType === filter.memoryType) &&
    (!filter.modality || metadata.modality === filter.modality)
  );
}

export class InMemoryVectorStore implements VectorStore {
  private readonly records = new Map<string, VectorRecord>();

  public async upsert(records: VectorRecord[]): Promise<void> {
    for (const record of records) this.records.set(record.id, structuredClone(record));
  }

  public async search(
    vector: number[],
    limit: number,
    filter: VectorSearchFilter = {},
  ): Promise<VectorHit[]> {
    return [...this.records.values()]
      .filter((record) => matches(record.metadata, filter))
      .map((record) => ({
        id: record.id,
        score: cosineSimilarity(vector, record.vector),
        metadata: structuredClone(record.metadata),
      }))
      .sort((left, right) => right.score - left.score)
      .slice(0, limit);
  }

  public async delete(ids: string[]): Promise<void> {
    for (const id of ids) this.records.delete(id);
  }

  public async clear(filter: VectorSearchFilter = {}): Promise<void> {
    for (const [id, record] of this.records) {
      if (matches(record.metadata, filter)) this.records.delete(id);
    }
  }
}
```

`HashEmbeddingClient` 只是可测试的教学替身，不是真正的语义模型。

## 九、Step 7：长期记忆公共基类

情景、语义和感知记忆都需要完成相同的文档存储、向量写入、更新、删除、清空和统计逻辑。先创建公共基类，可以避免复制三套容易产生差异的 CRUD。

创建 `src/memory/types/stored-memory.ts`：

```ts
import {
  BaseMemory,
  type MemorySearchOptions,
  type MemoryStats,
  type UpdateMemoryInput,
} from "../base.js";
import type { EmbeddingClient } from "../embedding.js";
import { memoryItemSchema } from "../schemas.js";
import type { MemoryItem, MemoryType } from "../schemas.js";
import type { DocumentStore } from "../storage/document-store.js";
import type {
  VectorHit,
  VectorStore,
} from "../storage/vector-store.js";

export abstract class StoredMemory extends BaseMemory {
  public abstract readonly type: MemoryType;

  protected constructor(
    protected readonly documents: DocumentStore,
    protected readonly vectors: VectorStore,
    protected readonly embeddings: EmbeddingClient,
  ) {
    super();
  }

  protected async storeItem(item: MemoryItem): Promise<string> {
    const parsed = memoryItemSchema.parse(item);

    if (parsed.memoryType !== this.type) {
      throw new Error(
        `${this.constructor.name} 不能保存 ${parsed.memoryType} 记忆`,
      );
    }

    await this.documents.add(parsed);

    try {
      const vector = await this.embeddings.embed(parsed.content);

      await this.vectors.upsert([
        {
          id: parsed.id,
          vector,
          metadata: {
            memoryId: parsed.id,
            userId: parsed.userId,
            memoryType: parsed.memoryType,
            importance: parsed.importance,
            ...parsed.metadata,
          },
        },
      ]);
    } catch (error: unknown) {
      // 文档写入成功但向量写入失败时，回滚文档，避免半条记忆。
      await this.documents.delete(parsed.id);
      throw error;
    }

    return parsed.id;
  }

  protected async searchVectorCandidates(
    query: string,
    options: MemorySearchOptions,
    modality?: string,
  ): Promise<VectorHit[]> {
    const vector = await this.embeddings.embed(query);
    const limit = Math.max((options.limit ?? 5) * 5, 20);

    return this.vectors.search(vector, limit, {
      memoryType: this.type,
      ...(options.userId ? { userId: options.userId } : {}),
      ...(modality ? { modality } : {}),
    });
  }

  protected matchesOptions(
    item: MemoryItem,
    options: MemorySearchOptions,
  ): boolean {
    if (options.userId && item.userId !== options.userId) return false;
    if (
      options.minImportance !== undefined &&
      item.importance < options.minImportance
    ) {
      return false;
    }
    if (options.startTime && item.timestamp < options.startTime) return false;
    if (options.endTime && item.timestamp > options.endTime) return false;
    return true;
  }

  public async update(
    memoryId: string,
    input: UpdateMemoryInput,
  ): Promise<boolean> {
    const current = await this.documents.get(memoryId);

    if (!current || current.memoryType !== this.type) return false;

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

    await this.documents.update(updated);

    try {
      const vector = await this.embeddings.embed(updated.content);
      await this.vectors.upsert([
        {
          id: updated.id,
          vector,
          metadata: {
            memoryId: updated.id,
            userId: updated.userId,
            memoryType: updated.memoryType,
            importance: updated.importance,
            ...updated.metadata,
          },
        },
      ]);
    } catch (error: unknown) {
      // 恢复文档和旧向量。
      await this.documents.update(current);
      const oldVector = await this.embeddings.embed(current.content);
      await this.vectors.upsert([
        {
          id: current.id,
          vector: oldVector,
          metadata: {
            memoryId: current.id,
            userId: current.userId,
            memoryType: current.memoryType,
            importance: current.importance,
            ...current.metadata,
          },
        },
      ]);
      throw error;
    }

    return true;
  }

  public async remove(memoryId: string): Promise<boolean> {
    const item = await this.documents.get(memoryId);
    if (!item || item.memoryType !== this.type) return false;

    await this.vectors.delete([memoryId]);
    return this.documents.delete(memoryId);
  }

  public async has(memoryId: string): Promise<boolean> {
    const item = await this.documents.get(memoryId);
    return item?.memoryType === this.type;
  }

  public async getAll(userId?: string): Promise<MemoryItem[]> {
    return this.documents.list({
      memoryType: this.type,
      ...(userId ? { userId } : {}),
    });
  }

  public async clear(userId?: string): Promise<void> {
    const items = await this.getAll(userId);
    const ids = items.map((item) => item.id);

    if (ids.length > 0) await this.vectors.delete(ids);

    for (const id of ids) {
      await this.documents.delete(id);
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
}
```

关键点：

- `StoredMemory` 不实现 `add()` 和 `retrieve()`，因为每种长期记忆的写入扩展和评分方式不同。
- `storeItem()` 负责文档和向量双写，并在向量写入失败时回滚文档。
- `update()` 在重新嵌入失败时恢复旧文档和旧向量。
- 第二阶段可以用 outbox 或待索引状态改进跨数据库一致性。

## 十、Step 8：情景记忆

创建 `src/memory/types/episodic-memory.ts`：

```ts
import type { MemorySearchOptions } from "../base.js";
import type { EmbeddingClient } from "../embedding.js";
import {
  importanceWeight,
  recencyScore,
} from "../scoring.js";
import type {
  MemoryItem,
  MemorySearchResult,
} from "../schemas.js";
import type { DocumentStore } from "../storage/document-store.js";
import type { VectorStore } from "../storage/vector-store.js";
import { StoredMemory } from "./stored-memory.js";

export class EpisodicMemory extends StoredMemory {
  public readonly type = "episodic" as const;

  public constructor(
    documents: DocumentStore,
    vectors: VectorStore,
    embeddings: EmbeddingClient,
    private readonly now: () => Date = () => new Date(),
  ) {
    super(documents, vectors, embeddings);
  }

  public async add(item: MemoryItem): Promise<string> {
    return this.storeItem(item);
  }

  public async retrieve(
    query: string,
    options: MemorySearchOptions = {},
  ): Promise<MemorySearchResult[]> {
    if (!query.trim()) throw new Error("情景记忆查询不能为空");

    const limit = options.limit ?? 5;
    const hits = await this.searchVectorCandidates(query, options);
    const results: MemorySearchResult[] = [];

    for (const hit of hits) {
      const item = await this.documents.get(hit.id);
      if (!item || item.memoryType !== this.type) continue;
      if (!this.matchesOptions(item, options)) continue;

      const recency = recencyScore(item.timestamp, this.now());
      const relevance = hit.score * 0.8 + recency * 0.2;
      const score = relevance * importanceWeight(item.importance);

      results.push({
        item,
        score,
        signals: {
          relevance,
          vector: hit.score,
          recency,
          importance: item.importance,
        },
      });
    }

    return results.sort((left, right) => right.score - left.score).slice(0, limit);
  }

  public async getTimeline(
    userId: string,
    limit = 50,
  ): Promise<MemoryItem[]> {
    const items = await this.documents.list({
      userId,
      memoryType: this.type,
    });

    return items
      .sort((left, right) => right.timestamp.localeCompare(left.timestamp))
      .slice(0, limit);
  }

  public async getSessionEpisodes(
    userId: string,
    sessionId: string,
  ): Promise<MemoryItem[]> {
    const items = await this.documents.list({
      userId,
      memoryType: this.type,
    });

    return items
      .filter((item) => item.metadata.sessionId === sessionId)
      .sort((left, right) => left.timestamp.localeCompare(right.timestamp));
  }
}
```

创建 `tests/episodic-memory.test.ts`，至少验证：

1. 添加后 DocumentStore 和 VectorStore 都能找到数据。
2. `getSessionEpisodes()` 不返回其他会话。
3. `getTimeline()` 按时间倒序。
4. 内容同样相关时，最近事件排在更早事件前。
5. 删除后文档和向量都不可检索。

## 十一、Step 9：知识图谱和语义记忆

### 9.1 内存图存储

创建 `src/memory/storage/graph-store.ts`：

```ts
export interface Entity {
  id: string;
  userId: string;
  name: string;
  type: string;
  properties: Record<string, unknown>;
}

export interface Relation {
  id: string;
  userId: string;
  sourceId: string;
  targetId: string;
  type: string;
  memoryId: string;
  properties: Record<string, unknown>;
}

export interface GraphSearchHit {
  memoryId: string;
  score: number;
}

export interface GraphStore {
  addEntity(entity: Entity): Promise<void>;
  addRelation(relation: Relation): Promise<void>;
  findRelatedMemories(
    entities: Entity[],
    userId: string,
    maxDepth?: number,
  ): Promise<GraphSearchHit[]>;
  deleteByMemoryId(memoryId: string): Promise<void>;
  clear(userId?: string): Promise<void>;
}

export class InMemoryGraphStore implements GraphStore {
  private readonly entities = new Map<string, Entity>();
  private readonly relations = new Map<string, Relation>();

  public async addEntity(entity: Entity): Promise<void> {
    this.entities.set(entity.id, structuredClone(entity));
  }

  public async addRelation(relation: Relation): Promise<void> {
    if (!this.entities.has(relation.sourceId)) {
      throw new Error(`关系源实体不存在：${relation.sourceId}`);
    }
    if (!this.entities.has(relation.targetId)) {
      throw new Error(`关系目标实体不存在：${relation.targetId}`);
    }
    this.relations.set(relation.id, structuredClone(relation));
  }

  public async findRelatedMemories(
    entities: Entity[],
    userId: string,
    maxDepth = 2,
  ): Promise<GraphSearchHit[]> {
    const queue = entities.map((entity) => ({ id: entity.id, depth: 0 }));
    const visited = new Set<string>();
    const scores = new Map<string, number>();

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current || visited.has(current.id) || current.depth > maxDepth) continue;
      visited.add(current.id);

      for (const relation of this.relations.values()) {
        if (relation.userId !== userId) continue;

        const touchesSource = relation.sourceId === current.id;
        const touchesTarget = relation.targetId === current.id;
        if (!touchesSource && !touchesTarget) continue;

        const relationScore = 1 / (1 + current.depth);
        scores.set(
          relation.memoryId,
          Math.max(scores.get(relation.memoryId) ?? 0, relationScore),
        );

        if (current.depth < maxDepth) {
          queue.push({
            id: touchesSource ? relation.targetId : relation.sourceId,
            depth: current.depth + 1,
          });
        }
      }
    }

    return [...scores.entries()]
      .map(([memoryId, score]) => ({ memoryId, score }))
      .sort((left, right) => right.score - left.score);
  }

  public async deleteByMemoryId(memoryId: string): Promise<void> {
    for (const [id, relation] of this.relations) {
      if (relation.memoryId === memoryId) this.relations.delete(id);
    }

    const referenced = new Set<string>();
    for (const relation of this.relations.values()) {
      referenced.add(relation.sourceId);
      referenced.add(relation.targetId);
    }

    for (const id of this.entities.keys()) {
      if (!referenced.has(id)) this.entities.delete(id);
    }
  }

  public async clear(userId?: string): Promise<void> {
    if (!userId) {
      this.entities.clear();
      this.relations.clear();
      return;
    }

    for (const [id, relation] of this.relations) {
      if (relation.userId === userId) this.relations.delete(id);
    }
    for (const [id, entity] of this.entities) {
      if (entity.userId === userId) this.entities.delete(id);
    }
  }
}
```

### 9.2 规则知识提取器

创建 `src/memory/knowledge-extractor.ts`：

```ts
import { createHash, randomUUID } from "node:crypto";
import type { Entity, Relation } from "./storage/graph-store.js";

export interface KnowledgeContext {
  memoryId: string;
  userId: string;
}

export interface ExtractedKnowledge {
  entities: Entity[];
  relations: Relation[];
}

export interface KnowledgeExtractor {
  extract(
    content: string,
    context: KnowledgeContext,
  ): Promise<ExtractedKnowledge>;
}

function entityId(userId: string, name: string): string {
  return createHash("sha256")
    .update(`${userId}:${name.toLowerCase()}`)
    .digest("hex");
}

export class RuleBasedKnowledgeExtractor implements KnowledgeExtractor {
  public async extract(
    content: string,
    context: KnowledgeContext,
  ): Promise<ExtractedKnowledge> {
    const entityMap = new Map<string, Entity>();
    const relations: Relation[] = [];

    const patterns: Array<{ expression: RegExp; relation: string }> = [
      { expression: /([^，。；]+?)属于([^，。；]+)/g, relation: "BELONGS_TO" },
      { expression: /([^，。；]+?)喜欢([^，。；]+)/g, relation: "LIKES" },
      { expression: /([^，。；]+?)学习([^，。；]+)/g, relation: "LEARNS" },
      { expression: /([^，。；]+?)是(?:一种|一个)?([^，。；]+)/g, relation: "IS_A" },
    ];

    const addEntity = (rawName: string): Entity => {
      const name = rawName.trim();
      const id = entityId(context.userId, name);
      const existing = entityMap.get(id);
      if (existing) return existing;

      const entity: Entity = {
        id,
        userId: context.userId,
        name,
        type: "concept",
        properties: {},
      };
      entityMap.set(id, entity);
      return entity;
    };

    for (const pattern of patterns) {
      for (const match of content.matchAll(pattern.expression)) {
        const sourceName = match[1]?.trim();
        const targetName = match[2]?.trim();
        if (!sourceName || !targetName) continue;

        const source = addEntity(sourceName);
        const target = addEntity(targetName);

        relations.push({
          id: randomUUID(),
          userId: context.userId,
          sourceId: source.id,
          targetId: target.id,
          type: pattern.relation,
          memoryId: context.memoryId,
          properties: {},
        });
      }
    }

    // 查询文本不一定包含明确关系，补充英文术语实体用于图检索。
    for (const token of content.match(/[A-Za-z][A-Za-z0-9_+-]{1,}/g) ?? []) {
      addEntity(token);
    }

    return {
      entities: [...entityMap.values()],
      relations,
    };
  }
}
```

规则提取器只用于第一阶段验证数据流。它不能替代可靠的信息抽取模型，也会产生漏提取和误提取。

### 9.3 语义记忆

创建 `src/memory/types/semantic-memory.ts`：

```ts
import type { MemorySearchOptions } from "../base.js";
import type { EmbeddingClient } from "../embedding.js";
import type { KnowledgeExtractor } from "../knowledge-extractor.js";
import { importanceWeight } from "../scoring.js";
import type { MemoryItem, MemorySearchResult } from "../schemas.js";
import type { DocumentStore } from "../storage/document-store.js";
import type { GraphStore } from "../storage/graph-store.js";
import type { VectorStore } from "../storage/vector-store.js";
import { StoredMemory } from "./stored-memory.js";

export class SemanticMemory extends StoredMemory {
  public readonly type = "semantic" as const;

  public constructor(
    documents: DocumentStore,
    vectors: VectorStore,
    embeddings: EmbeddingClient,
    private readonly graph: GraphStore,
    private readonly extractor: KnowledgeExtractor,
  ) {
    super(documents, vectors, embeddings);
  }

  public async add(item: MemoryItem): Promise<string> {
    if (item.memoryType !== this.type) {
      throw new Error(`SemanticMemory 不能保存 ${item.memoryType} 记忆`);
    }

    const knowledge = await this.extractor.extract(item.content, {
      memoryId: item.id,
      userId: item.userId,
    });

    const enriched: MemoryItem = {
      ...item,
      metadata: {
        ...item.metadata,
        entityIds: knowledge.entities.map((entity) => entity.id),
      },
    };

    await this.storeItem(enriched);

    try {
      for (const entity of knowledge.entities) await this.graph.addEntity(entity);
      for (const relation of knowledge.relations) await this.graph.addRelation(relation);
    } catch (error: unknown) {
      await super.remove(item.id);
      await this.graph.deleteByMemoryId(item.id);
      throw error;
    }

    return item.id;
  }

  public async retrieve(
    query: string,
    options: MemorySearchOptions = {},
  ): Promise<MemorySearchResult[]> {
    if (!query.trim()) throw new Error("语义记忆查询不能为空");

    const userId = options.userId;
    if (!userId) throw new Error("语义图检索必须指定 userId");

    const limit = options.limit ?? 5;
    const vectorHits = await this.searchVectorCandidates(query, options);
    const queryKnowledge = await this.extractor.extract(query, {
      memoryId: "query",
      userId,
    });
    const graphHits = await this.graph.findRelatedMemories(
      queryKnowledge.entities,
      userId,
      2,
    );

    const vectorScores = new Map(vectorHits.map((hit) => [hit.id, hit.score]));
    const graphScores = new Map(
      graphHits.map((hit) => [hit.memoryId, hit.score]),
    );
    const ids = new Set([...vectorScores.keys(), ...graphScores.keys()]);
    const results: MemorySearchResult[] = [];

    for (const id of ids) {
      const item = await this.documents.get(id);
      if (!item || item.memoryType !== this.type) continue;
      if (!this.matchesOptions(item, options)) continue;

      const vector = vectorScores.get(id) ?? 0;
      const graph = graphScores.get(id) ?? 0;
      const relevance = vector * 0.7 + graph * 0.3;
      const score = relevance * importanceWeight(item.importance);

      results.push({
        item,
        score,
        signals: {
          relevance,
          vector,
          graph,
          importance: item.importance,
        },
      });
    }

    return results.sort((left, right) => right.score - left.score).slice(0, limit);
  }

  public override async remove(memoryId: string): Promise<boolean> {
    const removed = await super.remove(memoryId);
    if (removed) await this.graph.deleteByMemoryId(memoryId);
    return removed;
  }

  public override async clear(userId?: string): Promise<void> {
    const items = await this.getAll(userId);
    await super.clear(userId);
    for (const item of items) await this.graph.deleteByMemoryId(item.id);
  }
}
```

测试重点：规则提取、用户隔离、向量和图命中合并、相同 ID 去重、删除后图关系清理。

## 十二、Step 10：感知记忆

第一阶段没有 CLIP/CLAP 等跨模态模型，因此只对资源的文字描述进行嵌入，并使用 `modality` 做过滤。不要把这一版称为真正跨模态检索。

创建 `src/memory/types/perceptual-memory.ts`：

```ts
import { z } from "zod";
import type { MemorySearchOptions } from "../base.js";
import type { EmbeddingClient } from "../embedding.js";
import { importanceWeight, recencyScore } from "../scoring.js";
import type { MemoryItem, MemorySearchResult } from "../schemas.js";
import type { DocumentStore } from "../storage/document-store.js";
import type { VectorStore } from "../storage/vector-store.js";
import { StoredMemory } from "./stored-memory.js";

export const modalitySchema = z.enum(["text", "image", "audio", "video"]);
export type Modality = z.infer<typeof modalitySchema>;

export interface PerceptualSearchOptions extends MemorySearchOptions {
  targetModality?: Modality;
}

export class PerceptualMemory extends StoredMemory {
  public readonly type = "perceptual" as const;

  public constructor(
    documents: DocumentStore,
    vectors: VectorStore,
    embeddings: EmbeddingClient,
    private readonly now: () => Date = () => new Date(),
  ) {
    super(documents, vectors, embeddings);
  }

  public async add(item: MemoryItem): Promise<string> {
    modalitySchema.parse(item.metadata.modality);
    return this.storeItem(item);
  }

  public async retrieve(
    query: string,
    options: PerceptualSearchOptions = {},
  ): Promise<MemorySearchResult[]> {
    if (!query.trim()) throw new Error("感知记忆查询不能为空");

    const limit = options.limit ?? 5;
    const hits = await this.searchVectorCandidates(
      query,
      options,
      options.targetModality,
    );
    const results: MemorySearchResult[] = [];

    for (const hit of hits) {
      const item = await this.documents.get(hit.id);
      if (!item || item.memoryType !== this.type) continue;
      if (!this.matchesOptions(item, options)) continue;
      if (
        options.targetModality &&
        item.metadata.modality !== options.targetModality
      ) {
        continue;
      }

      const recency = recencyScore(item.timestamp, this.now());
      const relevance = hit.score * 0.8 + recency * 0.2;
      const score = relevance * importanceWeight(item.importance);

      results.push({
        item,
        score,
        signals: {
          relevance,
          vector: hit.score,
          recency,
          importance: item.importance,
        },
      });
    }

    return results.sort((left, right) => right.score - left.score).slice(0, limit);
  }

  public async getByModality(
    userId: string,
    modality: Modality,
    limit = 10,
  ): Promise<MemoryItem[]> {
    modalitySchema.parse(modality);
    const items = await this.getAll(userId);
    return items
      .filter((item) => item.metadata.modality === modality)
      .slice(0, limit);
  }
}
```

测试重点：拒绝非法模态、按模态过滤、不同用户隔离、描述相似度排序、删除同步清理向量。

完成 Step 7～10 后运行：

```bash
npm run typecheck
npm test -- episodic-memory.test.ts
npm test -- semantic-memory.test.ts
npm test -- perceptual-memory.test.ts
```

## 十三、Step 11：MemoryManager

创建 `src/memory/manager.ts`：

```ts
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
```

测试文件 `tests/memory-manager.test.ts` 至少覆盖：显式类型优先、自动分类、跨类型排序、用户隔离、更新删除、三种遗忘策略、工作记忆到情景记忆的整合，以及目标写入失败时保留源记忆。

## 十四、Step 12：MemoryTool

Chapter 7 的 `ToolRegistry.toOpenAiTools()` 要求输入 Schema 顶层为 JSON object。因此不要把 `z.discriminatedUnion()` 直接作为顶层 Schema。

创建 `src/tools/memory-tool.ts`。输入 Schema 必须保持顶层为 `z.object()`：

```ts
import { z } from "zod";
import type { MemoryManager } from "../memory/manager.js";
import {
  forgetStrategySchema,
  memoryTypeSchema,
} from "../memory/schemas.js";
import type { Tool } from "./tool.js";

const memoryToolInputSchema = z
  .object({
    action: z.enum([
      "add",
      "search",
      "update",
      "remove",
      "summary",
      "stats",
      "forget",
      "consolidate",
      "clear",
    ]),
    content: z.string().optional(),
    query: z.string().optional(),
    memoryId: z.string().optional(),
    memoryType: memoryTypeSchema.optional(),
    memoryTypes: z.array(memoryTypeSchema).optional(),
    importance: z.number().min(0).max(1).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    limit: z.number().int().positive().max(100).optional(),
    strategy: forgetStrategySchema.optional(),
    threshold: z.number().min(0).max(1).optional(),
    maxAgeDays: z.number().positive().optional(),
    fromType: memoryTypeSchema.optional(),
    toType: memoryTypeSchema.optional(),
    importanceThreshold: z.number().min(0).max(1).optional(),
    confirm: z.boolean().optional(),
  })
  .superRefine((input, context) => {
    if (input.action === "add" && !input.content?.trim()) {
      context.addIssue({ code: "custom", message: "add 操作需要 content" });
    }
    if (input.action === "search" && !input.query?.trim()) {
      context.addIssue({ code: "custom", message: "search 操作需要 query" });
    }
    if (["update", "remove"].includes(input.action) && !input.memoryId) {
      context.addIssue({ code: "custom", message: `${input.action} 操作需要 memoryId` });
    }
    if (input.action === "clear" && input.confirm !== true) {
      context.addIssue({ code: "custom", message: "clear 操作需要 confirm=true" });
    }
  });
```

在同一个文件中继续添加完整工具实现：

```ts
type MemoryToolInput = z.infer<typeof memoryToolInputSchema>;

function asJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export function createMemoryTool(
  manager: MemoryManager,
): Tool<MemoryToolInput> {
  return {
    name: "memory",
    description: [
      "管理当前用户的工作、情景、语义和感知记忆。",
      "支持添加、搜索、更新、删除、摘要、统计、遗忘、整合和清空。",
      "涉及用户历史和偏好时先搜索；只有明确需要长期保存时才添加。",
    ].join(""),
    inputSchema: memoryToolInputSchema,

    async execute(input): Promise<string> {
      switch (input.action) {
        case "add": {
          const memoryId = await manager.addMemory({
            content: input.content ?? "",
            ...(input.memoryType ? { memoryType: input.memoryType } : {}),
            ...(input.importance === undefined
              ? {}
              : { importance: input.importance }),
            ...(input.metadata ? { metadata: input.metadata } : {}),
          });
          return asJson({ success: true, memoryId });
        }

        case "search": {
          const results = await manager.retrieveMemories({
            query: input.query ?? "",
            ...(input.memoryTypes ? { memoryTypes: input.memoryTypes } : {}),
            ...(input.limit === undefined ? {} : { limit: input.limit }),
          });
          return asJson({
            success: true,
            count: results.length,
            results,
          });
        }

        case "update": {
          const updated = await manager.updateMemory(input.memoryId ?? "", {
            ...(input.content === undefined ? {} : { content: input.content }),
            ...(input.importance === undefined
              ? {}
              : { importance: input.importance }),
            ...(input.metadata ? { metadata: input.metadata } : {}),
          });
          return asJson({ success: updated });
        }

        case "remove": {
          const removed = await manager.removeMemory(input.memoryId ?? "");
          return asJson({ success: removed });
        }

        case "summary": {
          const memories = await manager.getSummary(input.limit ?? 10);
          return asJson({ success: true, memories });
        }

        case "stats": {
          return asJson({ success: true, stats: await manager.getStats() });
        }

        case "forget": {
          const count = await manager.forgetMemories({
            strategy: input.strategy ?? "importance_based",
            ...(input.threshold === undefined
              ? {}
              : { threshold: input.threshold }),
            ...(input.maxAgeDays === undefined
              ? {}
              : { maxAgeDays: input.maxAgeDays }),
          });
          return asJson({ success: true, forgottenCount: count });
        }

        case "consolidate": {
          const count = await manager.consolidateMemories({
            fromType: input.fromType ?? "working",
            toType: input.toType ?? "episodic",
            importanceThreshold: input.importanceThreshold ?? 0.7,
          });
          return asJson({ success: true, consolidatedCount: count });
        }

        case "clear": {
          // Schema 已要求 confirm=true，这里仍保留防御性检查。
          if (input.confirm !== true) throw new Error("清空记忆需要 confirm=true");
          await manager.clearAllMemories();
          return asJson({ success: true });
        }
      }
    },
  };
}
```

注意：上面两个代码块属于同一个文件，按顺序连续粘贴即可。

必须添加测试：

```ts
expect(() => registry.toOpenAiTools()).not.toThrow();
```

这能直接防止顶层 `anyOf` 与原生 Function Calling 不兼容的问题。

## 十五、Step 13：工厂和导出

创建 `src/memory/create-in-memory-manager.ts`：

```ts
import { HashEmbeddingClient } from "./embedding.js";
import { RuleBasedKnowledgeExtractor } from "./knowledge-extractor.js";
import { MemoryManager } from "./manager.js";
import {
  createDefaultMemoryConfig,
  memoryConfigSchema,
} from "./schemas.js";
import type { MemoryConfig } from "./schemas.js";
import { InMemoryDocumentStore } from "./storage/document-store.js";
import { InMemoryGraphStore } from "./storage/graph-store.js";
import { InMemoryVectorStore } from "./storage/vector-store.js";
import { EpisodicMemory } from "./types/episodic-memory.js";
import { PerceptualMemory } from "./types/perceptual-memory.js";
import { SemanticMemory } from "./types/semantic-memory.js";
import { WorkingMemory } from "./types/working-memory.js";

export interface CreateInMemoryManagerOptions {
  userId: string;
  config?: Partial<MemoryConfig>;
  now?: () => Date;
}

export function createInMemoryMemoryManager(
  options: CreateInMemoryManagerOptions,
): MemoryManager {
  const config = memoryConfigSchema.parse({
    ...createDefaultMemoryConfig(),
    ...(options.config ?? {}),
  });
  const now = options.now ?? (() => new Date());
  const documents = new InMemoryDocumentStore();
  const vectors = new InMemoryVectorStore();
  const graph = new InMemoryGraphStore();
  const embeddings = new HashEmbeddingClient(128);
  const extractor = new RuleBasedKnowledgeExtractor();

  const working = new WorkingMemory(config, now);
  const episodic = new EpisodicMemory(documents, vectors, embeddings, now);
  const semantic = new SemanticMemory(
    documents,
    vectors,
    embeddings,
    graph,
    extractor,
  );
  const perceptual = new PerceptualMemory(documents, vectors, embeddings, now);

  return new MemoryManager(
    options.userId,
    [working, episodic, semantic, perceptual],
    config,
    now,
  );
}
```

创建 `src/memory/index.ts`：

```ts
export { BaseMemory } from "./base.js";
export type {
  MemorySearchOptions,
  MemoryStats,
  UpdateMemoryInput,
} from "./base.js";
export {
  createInMemoryMemoryManager,
} from "./create-in-memory-manager.js";
export type {
  CreateInMemoryManagerOptions,
} from "./create-in-memory-manager.js";
export { MemoryManager } from "./manager.js";
export type {
  ForgetMemoriesInput,
  MemoryManagerStats,
} from "./manager.js";
export {
  createDefaultMemoryConfig,
  memoryConfigSchema,
  memoryItemSchema,
  memoryTypeSchema,
} from "./schemas.js";
export type {
  AddMemoryInput,
  ConsolidateMemoryInput,
  MemoryConfig,
  MemoryItem,
  MemorySearchResult,
  MemoryType,
  RetrieveMemoriesInput,
} from "./schemas.js";
```

然后完整修改 `src/tools/create-default-registry.ts`：

```ts
import type { MemoryManager } from "../memory/manager.js";
import { advancedCalculatorTool } from "./advanced-calculator.js";
import { createMemoryTool } from "./memory-tool.js";
import { createHybridSearchToolFromEnv } from "./search/hybrid-search.js";
import { ToolRegistry } from "./tool.js";

export interface CreateDefaultToolRegistryOptions {
  env?: NodeJS.ProcessEnv;
  includeSearch?: boolean;
  memoryManager?: MemoryManager;
}

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

  return registry;
}
```

不要在默认注册表中创建 `default_user` 的全局记忆实例。Manager 必须按照用户创建，防止用户数据混用。

## 十六、Step 14：Agent 集成顺序

### 14.1 FunctionCallAgent 集成

创建 `src/examples/memory-function-call-demo.ts`：

```ts
import "dotenv/config";
import { FunctionCallAgent } from "../agents/function-call/function-call-agent.js";
import { HelloAgentsLlm } from "../core/hello-agents-llm.js";
import { createInMemoryMemoryManager } from "../memory/index.js";
import { createDefaultToolRegistry } from "../tools/create-default-registry.js";

async function main(): Promise<void> {
  const manager = createInMemoryMemoryManager({ userId: "user-123" });
  const tools = createDefaultToolRegistry({
    includeSearch: false,
    memoryManager: manager,
  });

  // 这一步验证 MemoryTool Schema 可以转换为 OpenAI tools。
  console.log(JSON.stringify(tools.toOpenAiTools(), null, 2));

  const llm = new HelloAgentsLlm();
  const agent = new FunctionCallAgent({
    name: "记忆助手",
    llm,
    toolRegistry: tools,
    enableToolCalling: true,
    maxToolIterations: 6,
    systemPrompt: [
      "你是一个具有记忆能力的助手。",
      "用户明确要求记住信息时，调用 memory 的 add 操作。",
      "问题涉及用户偏好或历史事件时，先调用 search。",
      "不要保存密码、令牌、身份证号等敏感信息。",
      "不要编造工具执行结果。",
    ].join(""),
  });

  console.log((await agent.run("请记住我正在学习 TypeScript")).answer);
  console.log((await agent.run("我现在正在学习什么？")).answer);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
```

在 `package.json` 的 scripts 中增加：

```json
"demo:memory:function": "tsx src/examples/memory-function-call-demo.ts"
```

### 14.2 SimpleAgent 集成

创建 `src/examples/memory-simple-agent-demo.ts`：

```ts
import "dotenv/config";
import { SimpleAgent } from "../agents/simple/simple-agent.js";
import { HelloAgentsLlm } from "../core/hello-agents-llm.js";
import { createInMemoryMemoryManager } from "../memory/index.js";
import { createDefaultToolRegistry } from "../tools/create-default-registry.js";

async function main(): Promise<void> {
  const manager = createInMemoryMemoryManager({ userId: "user-123" });
  const tools = createDefaultToolRegistry({
    includeSearch: false,
    memoryManager: manager,
  });
  const agent = new SimpleAgent({
    name: "文本协议记忆助手",
    llm: new HelloAgentsLlm(),
    toolRegistry: tools,
    enableToolCalling: true,
    maxToolIterations: 6,
    systemPrompt: [
      "你是一个具有记忆能力的助手。",
      "用户要求记住信息时调用 memory add。",
      "回答历史和偏好问题前调用 memory search。",
    ].join(""),
  });

  console.log((await agent.run("请记住我喜欢使用 Node.js")).answer);
  console.log((await agent.run("我喜欢使用什么运行环境？")).answer);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
```

### 14.3 为什么暂时不自动注入

1. 首先通过 MemoryTool 验证完整生命周期。
2. 再接入 FunctionCallAgent，验证原生 Schema。
3. 再接入 SimpleAgent，验证文本工具协议。
4. 最后才考虑修改 Agent 基类，实现执行前自动检索、执行后自动记录。

仅注册 MemoryTool 表示“模型可以选择调用记忆”，不代表每轮自动检索。System Prompt 应补充：

```text
当问题涉及用户偏好、历史事件或以前保存的信息时，先调用 memory 的 search。
只有用户明确要求记住，或信息明显具有长期价值时，才调用 add。
不要保存密码、令牌、身份证号码等敏感信息。
```

完整自动记忆应作为后续功能：Agent 执行前调用 `getContext()`，执行后调用 `recordInteraction()`；不要在第一版同时实现，避免重复写入。

## 十七、Step 15：完整验收清单

```text
数据模型
[ ] 非法类型、空内容、越界重要性被拒绝
[ ] userId 和 ISO 时间戳始终存在

工作记忆
[ ] TTL 到期自动清理
[ ] 容量超限淘汰最低优先级
[ ] 不返回其他用户数据

情景记忆
[ ] 文档与向量双写
[ ] 支持 sessionId 和时间线
[ ] 最近事件获得近因性加权

语义记忆
[ ] 实体关系带 userId
[ ] 向量和图结果按 memoryId 合并
[ ] 删除同时清理文档、向量和图

感知记忆
[ ] modality 得到运行时校验
[ ] 第一阶段明确只检索文字描述

Manager
[ ] 显式类型覆盖自动分类
[ ] 跨类型结果按 score 排序
[ ] 三种遗忘策略正确
[ ] 整合失败时不丢失源记忆

Tool
[ ] Schema 顶层是 object
[ ] FunctionCallAgent 可以注册
[ ] clear 必须显式 confirm=true
[ ] 错误会变成可读 Observation
```

最终执行：

```bash
npm run typecheck
npm test
```

## 十八、第二阶段：把内存适配器升级为真实基础设施

第二阶段的目标不是重写记忆算法，而是把第一阶段的三个内存存储和哈希嵌入替换为真实后端：

~~~text
MemoryManager / MemoryTool / Agent
              │
              ▼
WorkingMemory（仍然保留在进程内）
              │
              ├── EpisodicMemory
              ├── SemanticMemory
              └── PerceptualMemory
                       │
                       ├── SqliteDocumentStore
                       ├── QdrantVectorStore
                       ├── Neo4jGraphStore
                       └── OpenAiCompatibleEmbeddingClient
~~~

这里继续使用第一阶段已经定义好的四个端口：

~~~ts
DocumentStore
VectorStore
GraphStore
EmbeddingClient
~~~

因此以下代码原则非常重要：

1. 不修改 `MemoryManager` 的业务职责。
2. 不把数据库 SDK 直接写进 `EpisodicMemory`、`SemanticMemory` 或 `PerceptualMemory`。
3. 不把 Embedding 请求塞进现有聊天 `LlmClient`。
4. 所有远程查询必须携带 `userId`，不能只在 Node.js 收到结果后再过滤。
5. SQLite、Qdrant 和 Neo4j 之间不存在共同事务，只能使用补偿、重试和一致性检查。

下面按顺序实现。不要一次创建所有文件；每完成一步都先运行该步骤的测试。

### Step 16：安装依赖并准备本地服务

#### 16.1 安装 Node.js 依赖

在 `chapter7/agent-patterns-ts` 目录执行：

~~~bash
npm install better-sqlite3 @qdrant/js-client-rest neo4j-driver
npm install -D @types/better-sqlite3
~~~

项目已经安装了 `openai` SDK，所以不需要再次安装。这里把它作为
OpenAI-compatible HTTP 客户端使用。实际请求发送到哪个厂商，由
`EMBEDDING_BASE_URL` 决定，不与 OpenAI 官方服务绑定。

当前教程使用的 `@qdrant/js-client-rest` 1.19.x 要求 Node.js 22 或更高版本；
先执行 `node --version` 确认运行时满足要求。本教程使用该版本的 `query()` API，
不要照搬旧版 SDK 的 `search()` 示例。

#### 16.2 创建本地基础设施

在项目根目录创建 `docker-compose.memory.yml`：

~~~yaml
services:
  qdrant:
    image: qdrant/qdrant:latest
    ports:
      - "6333:6333"
    volumes:
      - ./.data/qdrant:/qdrant/storage

  neo4j:
    image: neo4j:latest
    ports:
      - "7474:7474"
      - "7687:7687"
    environment:
      NEO4J_AUTH: neo4j/change-me-in-local-env
    volumes:
      - ./.data/neo4j:/data
~~~

启动服务：

~~~bash
docker compose -f docker-compose.memory.yml up -d
~~~

检查：

~~~bash
curl http://localhost:6333/collections
~~~

Neo4j 浏览器地址为 `http://localhost:7474`。

把运行数据加入 `.gitignore`：

~~~gitignore
.data/
*.sqlite
*.sqlite-shm
*.sqlite-wal
~~~

不要把数据库文件、Neo4j 数据目录或密钥提交到 Git。

#### 16.3 扩充环境变量示例

在 `.env.example` 末尾增加：

~~~dotenv
# 第二阶段记忆系统
MEMORY_SQLITE_PATH=.data/memory.sqlite

# 通用 Embedding 配置
# 当前示例使用 SiliconFlow；以后可替换为其他兼容厂商。
EMBEDDING_API_KEY=
EMBEDDING_BASE_URL=https://api.siliconflow.com/v1
EMBEDDING_MODEL=Qwen/Qwen3-Embedding-0.6B
EMBEDDING_DIMENSION=1024
# 模型支持 dimensions 请求参数时为 true；固定维度模型可设为 false
EMBEDDING_SEND_DIMENSIONS=true

QDRANT_URL=http://127.0.0.1:6333
QDRANT_API_KEY=
QDRANT_COLLECTION=agent_memories_v1

NEO4J_URI=bolt://127.0.0.1:7687
NEO4J_USERNAME=neo4j
NEO4J_PASSWORD=change-me-in-local-env
NEO4J_DATABASE=neo4j
~~~

`EMBEDDING_DIMENSION` 和 Qdrant collection 的向量维度必须完全一致。
当前示例中的 SiliconFlow `Qwen/Qwen3-Embedding-0.6B` 使用 1024 维。
更换厂商、模型或维度时，配置字段本身不需要改名。

即使新旧模型的维度相同，也不能默认认为它们位于相同的向量空间。
每次更换模型都应创建新的版本化 collection，例如
`agent_memories_v2`，然后重新为 SQLite 中的正文生成向量。

### Step 17：增加第二阶段配置

创建 `src/memory/production-memory-config.ts`：

~~~ts
import { z } from "zod";

const optionalNonEmptyString = z.preprocess(
  (value) => {
    if (typeof value !== "string") return value;
    const normalized = value.trim();
    return normalized === "" ? undefined : normalized;
  },
  z.string().min(1).optional(),
);

const productionMemoryEnvSchema = z.object({
  MEMORY_SQLITE_PATH: z.string().trim().min(1),

  EMBEDDING_API_KEY: z.string().trim().min(1),
  EMBEDDING_BASE_URL: z
    .string()
    .url()
    .default("https://api.siliconflow.com/v1"),
  EMBEDDING_MODEL: z
    .string()
    .trim()
    .min(1)
    .default("Qwen/Qwen3-Embedding-0.6B"),
  EMBEDDING_DIMENSION: z.coerce
    .number()
    .int()
    .positive()
    .default(1024),
  EMBEDDING_SEND_DIMENSIONS: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .default(true),

  QDRANT_URL: z.string().url(),
  QDRANT_API_KEY: optionalNonEmptyString,
  QDRANT_COLLECTION: z
    .string()
    .trim()
    .min(1)
    .default("agent_memories_v1"),

  NEO4J_URI: z.string().trim().min(1),
  NEO4J_USERNAME: z.string().trim().min(1),
  NEO4J_PASSWORD: z.string().min(1),
  NEO4J_DATABASE: z.string().trim().min(1).default("neo4j"),
});

export type ProductionMemoryConfig = z.infer<
  typeof productionMemoryEnvSchema
>;

export function loadProductionMemoryConfig(
  env: NodeJS.ProcessEnv = process.env,
): ProductionMemoryConfig {
  const result = productionMemoryEnvSchema.safeParse(env);

  if (!result.success) {
    throw new Error(
      [
        "第二阶段记忆系统环境变量不完整：",
        z.prettifyError(result.error),
      ].join("\n"),
    );
  }

  return result.data;
}
~~~

重点解释：

- 单独创建配置文件，不要强迫所有普通示例都配置 Qdrant 和 Neo4j。
- 空字符串形式的可选 API Key 必须转换为 `undefined`。
- 配置加载失败应在应用启动阶段暴露，而不是等到第一次保存记忆时才报错。

创建 `tests/production-memory-config.test.ts`：

~~~ts
import { describe, expect, it } from "vitest";
import { loadProductionMemoryConfig } from "../src/memory/production-memory-config.js";

function validEnv(): NodeJS.ProcessEnv {
  return {
    MEMORY_SQLITE_PATH: ".data/test.sqlite",
    EMBEDDING_API_KEY: "test-key",
    EMBEDDING_BASE_URL: "https://api.siliconflow.com/v1",
    EMBEDDING_MODEL: "Qwen/Qwen3-Embedding-0.6B",
    EMBEDDING_DIMENSION: "1024",
    EMBEDDING_SEND_DIMENSIONS: "true",
    QDRANT_URL: "http://127.0.0.1:6333",
    QDRANT_API_KEY: "",
    QDRANT_COLLECTION: "test_memories",
    NEO4J_URI: "bolt://127.0.0.1:7687",
    NEO4J_USERNAME: "neo4j",
    NEO4J_PASSWORD: "password",
    NEO4J_DATABASE: "neo4j",
  };
}

describe("loadProductionMemoryConfig", () => {
  it("能够解析第二阶段配置", () => {
    const config = loadProductionMemoryConfig(validEnv());

    expect(config.EMBEDDING_DIMENSION).toBe(1024);
    expect(config.QDRANT_API_KEY).toBeUndefined();
  });

  it("可以切换其他兼容厂商、模型和维度", () => {
    const env = validEnv();
    env.EMBEDDING_BASE_URL = "https://embedding.example.com/v1";
    env.EMBEDDING_MODEL = "vendor/embedding-model-v2";
    env.EMBEDDING_DIMENSION = "768";
    env.EMBEDDING_SEND_DIMENSIONS = "false";
    env.QDRANT_COLLECTION = "agent_memories_v2";

    const config = loadProductionMemoryConfig(env);

    expect(config.EMBEDDING_BASE_URL).toBe(
      "https://embedding.example.com/v1",
    );
    expect(config.EMBEDDING_MODEL).toBe(
      "vendor/embedding-model-v2",
    );
    expect(config.EMBEDDING_DIMENSION).toBe(768);
    expect(config.EMBEDDING_SEND_DIMENSIONS).toBe(false);
    expect(config.QDRANT_COLLECTION).toBe("agent_memories_v2");
  });

  it("缺少必要配置时立即失败", () => {
    const env = validEnv();
    delete env.NEO4J_PASSWORD;

    expect(() => loadProductionMemoryConfig(env)).toThrow(
      "第二阶段记忆系统环境变量不完整",
    );
  });
});
~~~

### Step 18：实现 SqliteDocumentStore

SQLite 是记忆正文的权威数据源。Qdrant 只保存检索向量，Neo4j 只保存知识关系；完整 `MemoryItem` 必须能够从 SQLite 恢复。

创建 `src/memory/storage/sqlite-document-store.ts`：

~~~ts
import Database from "better-sqlite3";
import { memoryItemSchema } from "../schemas.js";
import type { MemoryItem } from "../schemas.js";
import type {
  DocumentFilter,
  DocumentStore,
} from "./document-store.js";

interface MemoryRow {
  id: string;
  content: string;
  memory_type: string;
  user_id: string;
  timestamp: string;
  importance: number;
  metadata_json: string;
}

type SqlParameter = string | number;

function rowToMemoryItem(row: MemoryRow): MemoryItem {
  let metadata: unknown;

  try {
    metadata = JSON.parse(row.metadata_json);
  } catch {
    throw new Error(`记忆 ${row.id} 的 metadata_json 不是合法 JSON`);
  }

  return memoryItemSchema.parse({
    id: row.id,
    content: row.content,
    memoryType: row.memory_type,
    userId: row.user_id,
    timestamp: row.timestamp,
    importance: row.importance,
    metadata,
  });
}

function buildWhere(filter: DocumentFilter): {
  clause: string;
  parameters: Record<string, SqlParameter>;
} {
  const conditions: string[] = [];
  const parameters: Record<string, SqlParameter> = {};

  if (filter.userId) {
    conditions.push("user_id = @userId");
    parameters.userId = filter.userId;
  }
  if (filter.memoryType) {
    conditions.push("memory_type = @memoryType");
    parameters.memoryType = filter.memoryType;
  }
  if (filter.minImportance !== undefined) {
    conditions.push("importance >= @minImportance");
    parameters.minImportance = filter.minImportance;
  }
  if (filter.startTime) {
    conditions.push("timestamp >= @startTime");
    parameters.startTime = filter.startTime;
  }
  if (filter.endTime) {
    conditions.push("timestamp <= @endTime");
    parameters.endTime = filter.endTime;
  }

  return {
    clause:
      conditions.length === 0
        ? ""
        : ` WHERE ${conditions.join(" AND ")}`,
    parameters,
  };
}

export class SqliteDocumentStore implements DocumentStore {
  public constructor(private readonly database: Database.Database) {
    this.database.pragma("journal_mode = WAL");
    this.database.pragma("foreign_keys = ON");
    this.migrate();
  }

  private migrate(): void {
    this.database.exec([
      "CREATE TABLE IF NOT EXISTS memories (",
      "  id TEXT PRIMARY KEY,",
      "  content TEXT NOT NULL,",
      "  memory_type TEXT NOT NULL,",
      "  user_id TEXT NOT NULL,",
      "  timestamp TEXT NOT NULL,",
      "  importance REAL NOT NULL CHECK (importance >= 0 AND importance <= 1),",
      "  metadata_json TEXT NOT NULL",
      ");",
      "CREATE INDEX IF NOT EXISTS idx_memories_user_type",
      "  ON memories(user_id, memory_type);",
      "CREATE INDEX IF NOT EXISTS idx_memories_user_timestamp",
      "  ON memories(user_id, timestamp DESC);",
      "CREATE INDEX IF NOT EXISTS idx_memories_user_importance",
      "  ON memories(user_id, importance DESC);",
    ].join("\n"));
  }

  public async add(item: MemoryItem): Promise<void> {
    const parsed = memoryItemSchema.parse(item);

    this.database
      .prepare([
        "INSERT INTO memories (",
        "  id, content, memory_type, user_id,",
        "  timestamp, importance, metadata_json",
        ") VALUES (",
        "  @id, @content, @memoryType, @userId,",
        "  @timestamp, @importance, @metadataJson",
        ")",
      ].join("\n"))
      .run({
        id: parsed.id,
        content: parsed.content,
        memoryType: parsed.memoryType,
        userId: parsed.userId,
        timestamp: parsed.timestamp,
        importance: parsed.importance,
        metadataJson: JSON.stringify(parsed.metadata),
      });
  }

  public async get(memoryId: string): Promise<MemoryItem | undefined> {
    const row = this.database
      .prepare("SELECT * FROM memories WHERE id = ?")
      .get(memoryId) as MemoryRow | undefined;

    return row ? rowToMemoryItem(row) : undefined;
  }

  public async list(filter: DocumentFilter = {}): Promise<MemoryItem[]> {
    const where = buildWhere(filter);
    const rows = this.database
      .prepare(
        [
          "SELECT * FROM memories",
          where.clause,
          " ORDER BY timestamp DESC",
        ].join(""),
      )
      .all(where.parameters) as MemoryRow[];

    return rows.map(rowToMemoryItem);
  }

  public async update(item: MemoryItem): Promise<void> {
    const parsed = memoryItemSchema.parse(item);
    const result = this.database
      .prepare([
        "UPDATE memories SET",
        " content = @content,",
        " memory_type = @memoryType,",
        " user_id = @userId,",
        " timestamp = @timestamp,",
        " importance = @importance,",
        " metadata_json = @metadataJson",
        " WHERE id = @id",
      ].join(""))
      .run({
        id: parsed.id,
        content: parsed.content,
        memoryType: parsed.memoryType,
        userId: parsed.userId,
        timestamp: parsed.timestamp,
        importance: parsed.importance,
        metadataJson: JSON.stringify(parsed.metadata),
      });

    if (result.changes === 0) {
      throw new Error(`记忆不存在：${parsed.id}`);
    }
  }

  public async delete(memoryId: string): Promise<boolean> {
    const result = this.database
      .prepare("DELETE FROM memories WHERE id = ?")
      .run(memoryId);

    return result.changes > 0;
  }

  public async clear(filter: DocumentFilter = {}): Promise<void> {
    const where = buildWhere(filter);
    this.database
      .prepare(`DELETE FROM memories${where.clause}`)
      .run(where.parameters);
  }
}
~~~

为什么元数据保存为 JSON：

- 第一阶段的 `metadata` 是开放结构，无法提前为每一个字段建列。
- `userId`、`memoryType`、`timestamp`、`importance` 是常用过滤条件，必须单独建列和索引。
- 读取数据库后仍然调用 `memoryItemSchema.parse()`，防止数据库脏数据直接进入领域层。

创建 `tests/sqlite-document-store.test.ts`：

~~~ts
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import type { MemoryItem } from "../src/memory/schemas.js";
import { SqliteDocumentStore } from "../src/memory/storage/sqlite-document-store.js";

function createItem(
  id: string,
  userId: string,
  memoryType: MemoryItem["memoryType"],
): MemoryItem {
  return {
    id,
    userId,
    memoryType,
    content: `${userId} 的 ${memoryType} 记忆`,
    timestamp: "2026-08-19T10:00:00.000Z",
    importance: 0.8,
    metadata: { source: "test" },
  };
}

describe("SqliteDocumentStore", () => {
  const databases: Database.Database[] = [];

  afterEach(() => {
    for (const database of databases) database.close();
    databases.length = 0;
  });

  function createStore(): SqliteDocumentStore {
    const database = new Database(":memory:");
    databases.push(database);
    return new SqliteDocumentStore(database);
  }

  it("支持新增、读取、更新和删除", async () => {
    const store = createStore();
    const item = createItem("memory-1", "user-1", "episodic");

    await store.add(item);
    expect(await store.get(item.id)).toEqual(item);

    await store.update({
      ...item,
      content: "更新后的内容",
      importance: 0.9,
    });

    expect(await store.get(item.id)).toMatchObject({
      content: "更新后的内容",
      importance: 0.9,
    });

    expect(await store.delete(item.id)).toBe(true);
    expect(await store.get(item.id)).toBeUndefined();
  });

  it("所有查询条件都在 SQLite 中完成用户隔离", async () => {
    const store = createStore();
    await store.add(createItem("one", "user-1", "semantic"));
    await store.add(createItem("two", "user-2", "semantic"));

    const items = await store.list({
      userId: "user-1",
      memoryType: "semantic",
      minImportance: 0.5,
    });

    expect(items.map((item) => item.id)).toEqual(["one"]);
  });

  it("clear(filter) 只删除匹配记录", async () => {
    const store = createStore();
    await store.add(createItem("one", "user-1", "episodic"));
    await store.add(createItem("two", "user-2", "episodic"));

    await store.clear({ userId: "user-1" });

    expect(await store.get("one")).toBeUndefined();
    expect(await store.get("two")).toBeDefined();
  });
});
~~~

### Step 19：实现通用 OpenAiCompatibleEmbeddingClient

许多厂商的 Embeddings API 兼容 OpenAI 请求结构，因此可以继续使用项目已有的
`openai` SDK 负责 HTTP 调用。适配器本身只依赖最小的
`embeddings.create()` 接口，便于测试，也避免领域层依赖具体厂商。

创建 `src/memory/openai-compatible-embedding.ts`：

~~~ts
import type { EmbeddingClient } from "./embedding.js";

export interface EmbeddingCreateRequest {
  model: string;
  input: string[];
  dimensions?: number;
  encoding_format: "float";
}

export interface EmbeddingCreateResponse {
  data: Array<{
    index: number;
    embedding: number[];
  }>;
}

export interface EmbeddingsApiClient {
  embeddings: {
    create(
      request: EmbeddingCreateRequest,
    ): Promise<EmbeddingCreateResponse>;
  };
}

export interface OpenAiCompatibleEmbeddingClientOptions {
  client: EmbeddingsApiClient;
  model: string;
  dimension: number;
  sendDimensions?: boolean;
  batchSize?: number;
}

export class OpenAiCompatibleEmbeddingClient implements EmbeddingClient {
  public readonly dimension: number;
  private readonly client: EmbeddingsApiClient;
  private readonly model: string;
  private readonly batchSize: number;
  private readonly sendDimensions: boolean;

  public constructor(options: OpenAiCompatibleEmbeddingClientOptions) {
    this.client = options.client;
    this.model = options.model.trim();
    this.dimension = options.dimension;
    this.batchSize = options.batchSize ?? 100;
    this.sendDimensions = options.sendDimensions ?? true;

    if (!this.model) {
      throw new Error("Embedding model 不能为空");
    }
    if (!Number.isInteger(this.dimension) || this.dimension <= 0) {
      throw new Error("Embedding dimension 必须是正整数");
    }
    if (!Number.isInteger(this.batchSize) || this.batchSize <= 0) {
      throw new Error("Embedding batchSize 必须是正整数");
    }
  }

  public async embed(text: string): Promise<number[]> {
    const normalized = text.trim();
    if (!normalized) throw new Error("Embedding 文本不能为空");

    const vectors = await this.embedBatch([normalized]);
    const vector = vectors[0];
    if (!vector) throw new Error("Embedding API 没有返回向量");
    return vector;
  }

  public async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const normalized = texts.map((text) => text.trim());
    if (normalized.some((text) => text.length === 0)) {
      throw new Error("Embedding 文本不能为空");
    }

    const vectors: number[][] = [];

    for (let start = 0; start < normalized.length; start += this.batchSize) {
      const batch = normalized.slice(start, start + this.batchSize);
      const response = await this.client.embeddings.create({
        model: this.model,
        input: batch,
        encoding_format: "float",
        ...(this.sendDimensions
          ? { dimensions: this.dimension }
          : {}),
      });

      const ordered = [...response.data].sort(
        (left, right) => left.index - right.index,
      );

      if (ordered.length !== batch.length) {
        throw new Error(
          `Embedding 数量不匹配：期望 ${batch.length}，实际 ${ordered.length}`,
        );
      }

      for (const item of ordered) {
        if (item.embedding.length !== this.dimension) {
          throw new Error(
            `Embedding 维度不匹配：期望 ${this.dimension}，实际 ${item.embedding.length}`,
          );
        }
        vectors.push(item.embedding);
      }
    }

    return vectors;
  }
}
~~~

关键点：

- `dimension` 是端口的一部分，Qdrant 建 collection 时必须使用同一值。
- `sendDimensions=true` 表示把 `dimensions` 发给支持动态维度的模型；
  固定维度模型设置为 `false`，但响应向量仍必须通过本地维度校验。
- 批量接口必须按返回结果的 `index` 排序，不能假设 SDK 永远保持输入顺序。
- 不要在单元测试中调用真实厂商 API。这里特意只依赖 `embeddings.create()`，使测试可以注入最小假客户端。
- 真正的联网冒烟测试应单独放置，并通过环境变量显式开启，避免普通 `npm test` 产生费用。

创建 `tests/openai-compatible-embedding.test.ts`：

~~~ts
import { describe, expect, it } from "vitest";
import {
  OpenAiCompatibleEmbeddingClient,
  type EmbeddingCreateRequest,
  type EmbeddingsApiClient,
} from "../src/memory/openai-compatible-embedding.js";

class FakeEmbeddingsApiClient implements EmbeddingsApiClient {
  public readonly requests: EmbeddingCreateRequest[] = [];

  public readonly embeddings = {
    create: async (
      request: EmbeddingCreateRequest,
    ): Promise<{
      data: Array<{ index: number; embedding: number[] }>;
    }> => {
      this.requests.push(request);

      /*
       * 故意倒序返回，用来证明实现会按照 index 恢复输入顺序。
       */
      return {
        data: request.input
          .map((text, index) => ({
            index,
            embedding: [
              text.length,
              index,
              request.dimensions ?? 3,
            ],
          }))
          .reverse(),
      };
    },
  };
}

describe("OpenAiCompatibleEmbeddingClient", () => {
  it("批量请求会按照响应 index 恢复顺序", async () => {
    const api = new FakeEmbeddingsApiClient();
    const client = new OpenAiCompatibleEmbeddingClient({
      client: api,
      model: "test-embedding",
      dimension: 3,
      batchSize: 10,
    });

    const vectors = await client.embedBatch(["a", "hello"]);

    expect(vectors).toEqual([
      [1, 0, 3],
      [5, 1, 3],
    ]);
    expect(api.requests[0]).toEqual({
      model: "test-embedding",
      input: ["a", "hello"],
      dimensions: 3,
      encoding_format: "float",
    });
  });

  it("超过 batchSize 时拆分请求且保持全局顺序", async () => {
    const api = new FakeEmbeddingsApiClient();
    const client = new OpenAiCompatibleEmbeddingClient({
      client: api,
      model: "test-embedding",
      dimension: 3,
      batchSize: 2,
    });

    const vectors = await client.embedBatch(["a", "bb", "ccc"]);

    expect(api.requests).toHaveLength(2);
    expect(vectors).toHaveLength(3);
    expect(vectors[0]?.[0]).toBe(1);
    expect(vectors[1]?.[0]).toBe(2);
    expect(vectors[2]?.[0]).toBe(3);
  });

  it("固定维度模型可以不发送 dimensions 参数", async () => {
    const api = new FakeEmbeddingsApiClient();
    const client = new OpenAiCompatibleEmbeddingClient({
      client: api,
      model: "fixed-dimension-model",
      dimension: 3,
      sendDimensions: false,
    });

    await client.embed("hello");

    expect(api.requests[0]).not.toHaveProperty("dimensions");
  });

  it("拒绝空文本和错误维度", async () => {
    const api = new FakeEmbeddingsApiClient();
    const client = new OpenAiCompatibleEmbeddingClient({
      client: api,
      model: "test-embedding",
      dimension: 4,
    });

    await expect(client.embed("   ")).rejects.toThrow(
      "Embedding 文本不能为空",
    );

    await expect(client.embed("hello")).rejects.toThrow(
      "Embedding 维度不匹配",
    );
  });
});
~~~

当前默认示例仍然使用 SiliconFlow。完成单元测试后，可以手动执行一次真实接口
冒烟测试。先确保当前终端已经设置 `EMBEDDING_API_KEY`，然后执行：

~~~bash
curl --request POST \
  --url https://api.siliconflow.com/v1/embeddings \
  --header "Authorization: Bearer ${EMBEDDING_API_KEY}" \
  --header "Content-Type: application/json" \
  --data '{
    "model": "Qwen/Qwen3-Embedding-0.6B",
    "input": "TypeScript 智能体记忆系统",
    "encoding_format": "float",
    "dimensions": 1024
  }'
~~~

响应中的 `data[0].embedding` 应为长度 1024 的数字数组。不要把真实 API Key
直接写进命令历史、测试文件或教程文档；这里通过环境变量传入。

以后更换为其他 OpenAI-compatible 厂商时，只修改：

~~~dotenv
EMBEDDING_API_KEY=新厂商密钥
EMBEDDING_BASE_URL=https://新厂商地址/v1
EMBEDDING_MODEL=新模型名称
EMBEDDING_DIMENSION=新模型输出维度
EMBEDDING_SEND_DIMENSIONS=true或false
QDRANT_COLLECTION=agent_memories_v2
~~~

如果新厂商不兼容 OpenAI Embeddings 协议，则新建另一个实现
`EmbeddingClient` 的适配器，不要修改 `StoredMemory` 或 `MemoryManager`。

### Step 20：实现 QdrantVectorStore

创建 `src/memory/storage/qdrant-vector-store.ts`：

~~~ts
import { QdrantClient } from "@qdrant/js-client-rest";
import type {
  VectorHit,
  VectorRecord,
  VectorSearchFilter,
  VectorStore,
} from "./vector-store.js";

export interface QdrantVectorStoreOptions {
  client: QdrantClient;
  collectionName: string;
  dimension: number;
}

function buildFilter(filter: VectorSearchFilter): {
  must: Array<{
    key: string;
    match: { value: string };
  }>;
} {
  const must: Array<{
    key: string;
    match: { value: string };
  }> = [];

  if (filter.userId) {
    must.push({ key: "userId", match: { value: filter.userId } });
  }
  if (filter.memoryType) {
    must.push({
      key: "memoryType",
      match: { value: filter.memoryType },
    });
  }
  if (filter.modality) {
    must.push({ key: "modality", match: { value: filter.modality } });
  }

  return { must };
}

function payloadToMetadata(
  payload: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  return payload ? structuredClone(payload) : {};
}

function readUnnamedVectorSize(vectors: unknown): number | undefined {
  if (
    typeof vectors !== "object" ||
    vectors === null ||
    !("size" in vectors)
  ) {
    return undefined;
  }

  const size = vectors.size;
  return typeof size === "number" ? size : undefined;
}

export class QdrantVectorStore implements VectorStore {
  private readonly ready: Promise<void>;

  public constructor(private readonly options: QdrantVectorStoreOptions) {
    if (!Number.isInteger(options.dimension) || options.dimension <= 0) {
      throw new Error("Qdrant 向量维度必须是正整数");
    }
    this.ready = this.ensureCollection();
  }

  private async ensureCollection(): Promise<void> {
    const collections = await this.options.client.getCollections();
    const exists = collections.collections.some(
      (collection) => collection.name === this.options.collectionName,
    );

    if (!exists) {
      await this.options.client.createCollection(
        this.options.collectionName,
        {
          vectors: {
            size: this.options.dimension,
            distance: "Cosine",
          },
        },
      );
    } else {
      const collection = await this.options.client.getCollection(
        this.options.collectionName,
      );
      const actualDimension = readUnnamedVectorSize(
        collection.config.params.vectors,
      );

      if (actualDimension !== this.options.dimension) {
        throw new Error(
          [
            `Qdrant collection ${this.options.collectionName} 维度不匹配：`,
            `期望 ${this.options.dimension}，`,
            `实际 ${String(actualDimension ?? "未知")}。`,
            "更换模型或维度时请使用新的 collection 名称。",
          ].join(""),
        );
      }
    }

    for (const fieldName of ["userId", "memoryType", "modality"]) {
      await this.options.client.createPayloadIndex(
        this.options.collectionName,
        {
          field_name: fieldName,
          field_schema: "keyword",
          wait: true,
        },
      );
    }
  }

  public async initialize(): Promise<void> {
    await this.ready;
  }

  public async upsert(records: VectorRecord[]): Promise<void> {
    if (records.length === 0) return;
    await this.ready;

    for (const record of records) {
      if (record.vector.length !== this.options.dimension) {
        throw new Error(
          `向量 ${record.id} 维度不匹配：期望 ${this.options.dimension}，实际 ${record.vector.length}`,
        );
      }
    }

    await this.options.client.upsert(this.options.collectionName, {
      wait: true,
      points: records.map((record) => ({
        id: record.id,
        vector: record.vector,
        payload: record.metadata,
      })),
    });
  }

  public async search(
    vector: number[],
    limit: number,
    filter: VectorSearchFilter = {},
  ): Promise<VectorHit[]> {
    await this.ready;

    if (vector.length !== this.options.dimension) {
      throw new Error(
        `查询向量维度不匹配：期望 ${this.options.dimension}，实际 ${vector.length}`,
      );
    }

    const response = await this.options.client.query(
      this.options.collectionName,
      {
        query: vector,
        limit,
        filter: buildFilter(filter),
        with_payload: true,
        with_vector: false,
      },
    );

    return response.points.map((hit) => ({
      id: String(hit.id),
      score: hit.score,
      metadata: payloadToMetadata(hit.payload),
    }));
  }

  public async delete(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.ready;

    await this.options.client.delete(this.options.collectionName, {
      wait: true,
      points: ids,
    });
  }

  public async clear(filter: VectorSearchFilter = {}): Promise<void> {
    await this.ready;

    await this.options.client.delete(this.options.collectionName, {
      wait: true,
      filter: buildFilter(filter),
    });
  }
}
~~~

注意：Qdrant point ID 只支持无符号整数或 UUID。当前 `MemoryManager` 使用 `randomUUID()` 生成生产记忆 ID，因此可以直接作为 point ID。测试里常见的 `"memory-1"` 不能用于真实 Qdrant 集成测试，集成测试应使用 `randomUUID()`。

为什么过滤必须下推到 Qdrant：

~~~text
错误做法：
搜索整个 collection → Node.js 再过滤 userId

正确做法：
Qdrant filter(userId, memoryType, modality) → 只返回当前用户候选
~~~

错误做法既会泄露其他用户的候选信息，也会让其他用户的数据挤占 `limit`。

集成测试创建 `tests/qdrant-vector-store.integration.test.ts`。默认跳过，只有设置 `RUN_MEMORY_INTEGRATION_TESTS=true` 才运行：

~~~ts
import { randomUUID } from "node:crypto";
import { QdrantClient } from "@qdrant/js-client-rest";
import { describe, expect, it } from "vitest";
import { QdrantVectorStore } from "../src/memory/storage/qdrant-vector-store.js";

const describeIntegration =
  process.env.RUN_MEMORY_INTEGRATION_TESTS === "true"
    ? describe
    : describe.skip;

describeIntegration("QdrantVectorStore integration", () => {
  it("写入和搜索都按 userId 隔离", async () => {
    const dimension = 4;
    const collectionName = `test_${randomUUID().replaceAll("-", "_")}`;
    const client = new QdrantClient({
      url: process.env.QDRANT_URL ?? "http://127.0.0.1:6333",
      ...(process.env.QDRANT_API_KEY
        ? { apiKey: process.env.QDRANT_API_KEY }
        : {}),
    });
    const store = new QdrantVectorStore({
      client,
      collectionName,
      dimension,
    });

    const userOneId = randomUUID();
    const userTwoId = randomUUID();

    try {
      await store.upsert([
        {
          id: userOneId,
          vector: [1, 0, 0, 0],
          metadata: {
            memoryId: userOneId,
            userId: "user-1",
            memoryType: "semantic",
          },
        },
        {
          id: userTwoId,
          vector: [1, 0, 0, 0],
          metadata: {
            memoryId: userTwoId,
            userId: "user-2",
            memoryType: "semantic",
          },
        },
      ]);

      const hits = await store.search([1, 0, 0, 0], 10, {
        userId: "user-1",
        memoryType: "semantic",
      });

      expect(hits.map((hit) => hit.id)).toEqual([userOneId]);
    } finally {
      await client.deleteCollection(collectionName);
    }
  });
});
~~~

### Step 21：实现 Neo4jGraphStore

Neo4j 中不要使用动态关系类型保存业务关系。统一使用 `:MEMORY_RELATION`，把 `LIKES`、`IS_A` 等值保存在关系的 `type` 属性中。这样可以继续使用参数化查询，避免把未经校验的字符串拼进 Cypher。

创建 `src/memory/storage/neo4j-graph-store.ts`：

~~~ts
import type { Driver } from "neo4j-driver";
import type {
  Entity,
  GraphSearchHit,
  GraphStore,
  Relation,
} from "./graph-store.js";

export interface Neo4jGraphStoreOptions {
  driver: Driver;
  database: string;
}

export class Neo4jGraphStore implements GraphStore {
  private readonly ready: Promise<void>;

  public constructor(private readonly options: Neo4jGraphStoreOptions) {
    this.ready = this.ensureSchema();
  }

  private async ensureSchema(): Promise<void> {
    await this.options.driver.executeQuery(
      [
        "CREATE CONSTRAINT memory_entity_id IF NOT EXISTS",
        "FOR (entity:MemoryEntity)",
        "REQUIRE entity.id IS UNIQUE",
      ].join(" "),
      {},
      { database: this.options.database },
    );
  }

  public async initialize(): Promise<void> {
    await this.ready;
  }

  public async addEntity(entity: Entity): Promise<void> {
    await this.ready;

    await this.options.driver.executeQuery(
      [
        "MERGE (entity:MemoryEntity {id: $id})",
        "SET entity.userId = $userId,",
        "    entity.name = $name,",
        "    entity.type = $type,",
        "    entity.propertiesJson = $propertiesJson",
      ].join("\n"),
      {
        id: entity.id,
        userId: entity.userId,
        name: entity.name,
        type: entity.type,
        propertiesJson: JSON.stringify(entity.properties),
      },
      { database: this.options.database },
    );
  }

  public async addRelation(relation: Relation): Promise<void> {
    await this.ready;

    const result = await this.options.driver.executeQuery(
      [
        "MATCH (source:MemoryEntity {id: $sourceId, userId: $userId})",
        "MATCH (target:MemoryEntity {id: $targetId, userId: $userId})",
        "MERGE (source)-[edge:MEMORY_RELATION {id: $id}]->(target)",
        "SET edge.userId = $userId,",
        "    edge.type = $type,",
        "    edge.memoryId = $memoryId,",
        "    edge.propertiesJson = $propertiesJson",
        "RETURN edge.id AS id",
      ].join("\n"),
      {
        id: relation.id,
        userId: relation.userId,
        sourceId: relation.sourceId,
        targetId: relation.targetId,
        type: relation.type,
        memoryId: relation.memoryId,
        propertiesJson: JSON.stringify(relation.properties),
      },
      { database: this.options.database },
    );

    if (result.records.length !== 1) {
      throw new Error(
        `无法创建关系 ${relation.id}：源实体或目标实体不存在`,
      );
    }
  }

  public async findRelatedMemories(
    entities: Entity[],
    userId: string,
    maxDepth = 2,
  ): Promise<GraphSearchHit[]> {
    await this.ready;
    if (entities.length === 0) return [];

    const depth = Math.max(1, Math.min(5, Math.trunc(maxDepth)));
    const entityIds = entities
      .filter((entity) => entity.userId === userId)
      .map((entity) => entity.id);

    if (entityIds.length === 0) return [];

    /*
     * Cypher 的可变路径深度不能使用普通参数代替，
     * 所以这里只拼接经过整数截断和范围限制的 depth。
     */
    const query = [
      "MATCH (start:MemoryEntity)",
      "WHERE start.userId = $userId AND start.id IN $entityIds",
      `MATCH path = (start)-[:MEMORY_RELATION*1..${depth}]-(related)`,
      "WHERE related.userId = $userId",
      "  AND all(edge IN relationships(path) WHERE edge.userId = $userId)",
      "UNWIND relationships(path) AS edge",
      "WITH edge.memoryId AS memoryId,",
      "     max(1.0 / length(path)) AS score",
      "RETURN memoryId, score",
      "ORDER BY score DESC",
    ].join("\n");

    const result = await this.options.driver.executeQuery(
      query,
      { userId, entityIds },
      { database: this.options.database },
    );

    return result.records.map((record) => ({
      memoryId: String(record.get("memoryId")),
      score: Number(record.get("score")),
    }));
  }

  public async deleteByMemoryId(memoryId: string): Promise<void> {
    await this.ready;

    await this.options.driver.executeQuery(
      [
        "MATCH (source)-[edge:MEMORY_RELATION {memoryId: $memoryId}]-(target)",
        "WITH collect(DISTINCT source) + collect(DISTINCT target) AS candidates,",
        "     collect(DISTINCT edge) AS edges",
        "FOREACH (item IN edges | DELETE item)",
        "WITH candidates",
        "UNWIND candidates AS entity",
        "WITH DISTINCT entity",
        "WHERE NOT (entity)-[:MEMORY_RELATION]-()",
        "DELETE entity",
      ].join("\n"),
      { memoryId },
      { database: this.options.database },
    );
  }

  public async clear(userId?: string): Promise<void> {
    await this.ready;

    if (!userId) {
      await this.options.driver.executeQuery(
        "MATCH (entity:MemoryEntity) DETACH DELETE entity",
        {},
        { database: this.options.database },
      );
      return;
    }

    await this.options.driver.executeQuery(
      [
        "MATCH (entity:MemoryEntity {userId: $userId})",
        "DETACH DELETE entity",
      ].join("\n"),
      { userId },
      { database: this.options.database },
    );
  }
}
~~~

重点解释：

- `RuleBasedKnowledgeExtractor` 生成的实体 ID 已经包含 `userId`，因此实体不会跨用户合并。
- Cypher 查询仍然显式检查 `userId`，不能只依赖 ID 生成规则。
- Driver 是连接池，整个应用通常只创建一个实例；应用退出时统一 `close()`。
- 每次 `executeQuery()` 都显式指定 database，避免额外解析默认数据库。
- 路径深度最多限制为 5，防止图查询无限膨胀。

Neo4j 集成测试应至少验证：

1. 两个用户拥有同名实体时不会互相检索。
2. `deleteByMemoryId()` 删除目标关系并清理孤立实体。
3. `clear(userId)` 不会删除其他用户的实体。

创建 `tests/neo4j-graph-store.integration.test.ts`：

~~~ts
import { randomUUID } from "node:crypto";
import neo4j from "neo4j-driver";
import { describe, expect, it } from "vitest";
import type {
  Entity,
  Relation,
} from "../src/memory/storage/graph-store.js";
import { Neo4jGraphStore } from "../src/memory/storage/neo4j-graph-store.js";

const describeIntegration =
  process.env.RUN_MEMORY_INTEGRATION_TESTS === "true"
    ? describe
    : describe.skip;

function entity(
  id: string,
  userId: string,
  name: string,
): Entity {
  return {
    id,
    userId,
    name,
    type: "concept",
    properties: {},
  };
}

function relation(
  userId: string,
  sourceId: string,
  targetId: string,
  memoryId: string,
): Relation {
  return {
    id: randomUUID(),
    userId,
    sourceId,
    targetId,
    type: "LIKES",
    memoryId,
    properties: {},
  };
}

describeIntegration("Neo4jGraphStore integration", () => {
  it("图检索、删除和清空都保持用户隔离", async () => {
    const driver = neo4j.driver(
      process.env.NEO4J_URI ?? "bolt://127.0.0.1:7687",
      neo4j.auth.basic(
        process.env.NEO4J_USERNAME ?? "neo4j",
        process.env.NEO4J_PASSWORD ?? "change-me-in-local-env",
      ),
    );
    const store = new Neo4jGraphStore({
      driver,
      database: process.env.NEO4J_DATABASE ?? "neo4j",
    });
    const userOne = `test-user-${randomUUID()}`;
    const userTwo = `test-user-${randomUUID()}`;
    const userOneMemoryId = randomUUID();
    const userTwoMemoryId = randomUUID();
    const oneSource = entity(randomUUID(), userOne, "用户");
    const oneTarget = entity(randomUUID(), userOne, "TypeScript");
    const twoSource = entity(randomUUID(), userTwo, "用户");
    const twoTarget = entity(randomUUID(), userTwo, "TypeScript");

    try {
      await store.initialize();

      for (const item of [
        oneSource,
        oneTarget,
        twoSource,
        twoTarget,
      ]) {
        await store.addEntity(item);
      }

      await store.addRelation(
        relation(
          userOne,
          oneSource.id,
          oneTarget.id,
          userOneMemoryId,
        ),
      );
      await store.addRelation(
        relation(
          userTwo,
          twoSource.id,
          twoTarget.id,
          userTwoMemoryId,
        ),
      );

      const userOneHits = await store.findRelatedMemories(
        [oneSource],
        userOne,
      );

      expect(userOneHits.map((hit) => hit.memoryId)).toEqual([
        userOneMemoryId,
      ]);

      await store.deleteByMemoryId(userOneMemoryId);

      expect(
        await store.findRelatedMemories([oneSource], userOne),
      ).toEqual([]);

      await store.clear(userOne);

      const userTwoHits = await store.findRelatedMemories(
        [twoSource],
        userTwo,
      );
      expect(userTwoHits.map((hit) => hit.memoryId)).toEqual([
        userTwoMemoryId,
      ]);
    } finally {
      try {
        await store.clear(userOne);
        await store.clear(userTwo);
      } finally {
        await driver.close();
      }
    }
  });
});
~~~

集成测试使用随机用户和随机实体 ID，不能在共享开发数据库中执行无过滤的 `clear()`。

### Step 22：创建生产版工厂并管理资源生命周期

第一阶段的 `createInMemoryMemoryManager()` 必须保留，以便快速测试和无外部依赖运行。另建生产工厂，不要用环境判断偷偷改变原工厂行为。

创建 `src/memory/create-production-memory-manager.ts`：

~~~ts
import Database from "better-sqlite3";
import { QdrantClient } from "@qdrant/js-client-rest";
import neo4j, { type Driver } from "neo4j-driver";
import OpenAI from "openai";
import { RuleBasedKnowledgeExtractor } from "./knowledge-extractor.js";
import { MemoryManager } from "./manager.js";
import { OpenAiCompatibleEmbeddingClient } from "./openai-compatible-embedding.js";
import type { ProductionMemoryConfig } from "./production-memory-config.js";
import {
  createDefaultMemoryConfig,
  memoryConfigSchema,
} from "./schemas.js";
import type { MemoryConfig } from "./schemas.js";
import { Neo4jGraphStore } from "./storage/neo4j-graph-store.js";
import { QdrantVectorStore } from "./storage/qdrant-vector-store.js";
import { SqliteDocumentStore } from "./storage/sqlite-document-store.js";
import { EpisodicMemory } from "./types/episodic-memory.js";
import { PerceptualMemory } from "./types/perceptual-memory.js";
import { SemanticMemory } from "./types/semantic-memory.js";
import { WorkingMemory } from "./types/working-memory.js";

export interface CreateProductionMemoryManagerOptions {
  userId: string;
  infrastructure: ProductionMemoryConfig;
  config?: Partial<MemoryConfig>;
  now?: () => Date;
}

export interface ProductionMemoryRuntime {
  manager: MemoryManager;
  close(): Promise<void>;
}

export async function createProductionMemoryManager(
  options: CreateProductionMemoryManagerOptions,
): Promise<ProductionMemoryRuntime> {
  const memoryConfig = memoryConfigSchema.parse({
    ...createDefaultMemoryConfig(),
    ...(options.config ?? {}),
  });
  const now = options.now ?? (() => new Date());

  const sqlite = new Database(options.infrastructure.MEMORY_SQLITE_PATH);
  let neo4jDriver: Driver | undefined;

  try {
    const documents = new SqliteDocumentStore(sqlite);

    /*
     * OpenAI SDK 在这里只是 OpenAI-compatible 协议客户端。
     * 请求目标完全由 EMBEDDING_BASE_URL 决定。
     */
    const embeddingApi = new OpenAI({
      apiKey: options.infrastructure.EMBEDDING_API_KEY,
      baseURL: options.infrastructure.EMBEDDING_BASE_URL,
    });
    const embeddings = new OpenAiCompatibleEmbeddingClient({
      client: embeddingApi,
      model: options.infrastructure.EMBEDDING_MODEL,
      dimension: options.infrastructure.EMBEDDING_DIMENSION,
      sendDimensions:
        options.infrastructure.EMBEDDING_SEND_DIMENSIONS,
    });

    const qdrant = new QdrantClient({
      url: options.infrastructure.QDRANT_URL,
      ...(options.infrastructure.QDRANT_API_KEY
        ? { apiKey: options.infrastructure.QDRANT_API_KEY }
        : {}),
    });
    const vectors = new QdrantVectorStore({
      client: qdrant,
      collectionName: options.infrastructure.QDRANT_COLLECTION,
      dimension: embeddings.dimension,
    });
    await vectors.initialize();

    neo4jDriver = neo4j.driver(
      options.infrastructure.NEO4J_URI,
      neo4j.auth.basic(
        options.infrastructure.NEO4J_USERNAME,
        options.infrastructure.NEO4J_PASSWORD,
      ),
    );
    await neo4jDriver.verifyConnectivity();

    const graph = new Neo4jGraphStore({
      driver: neo4jDriver,
      database: options.infrastructure.NEO4J_DATABASE,
    });
    await graph.initialize();
    const extractor = new RuleBasedKnowledgeExtractor();

    const manager = new MemoryManager(
      options.userId,
      [
        new WorkingMemory(memoryConfig, now),
        new EpisodicMemory(documents, vectors, embeddings, now),
        new SemanticMemory(
          documents,
          vectors,
          embeddings,
          graph,
          extractor,
        ),
        new PerceptualMemory(documents, vectors, embeddings, now),
      ],
      memoryConfig,
      now,
    );

    const driver = neo4jDriver;

    return {
      manager,
      async close(): Promise<void> {
        await driver.close();
        sqlite.close();
      },
    };
  } catch (error: unknown) {
    if (neo4jDriver) await neo4jDriver.close();
    sqlite.close();
    throw error;
  }
}
~~~

为什么返回 `{ manager, close }`：

- `MemoryManager` 只关心记忆业务，不应该负责关闭数据库连接。
- SQLite 和 Neo4j Driver 属于应用级资源，必须在应用结束时释放。
- 如果工厂创建到一半失败，`catch` 必须清理已经创建的资源。

更新 `src/memory/index.ts`：

~~~ts
export {
  createProductionMemoryManager,
} from "./create-production-memory-manager.js";
export type {
  CreateProductionMemoryManagerOptions,
  ProductionMemoryRuntime,
} from "./create-production-memory-manager.js";
export {
  loadProductionMemoryConfig,
} from "./production-memory-config.js";
export type {
  ProductionMemoryConfig,
} from "./production-memory-config.js";
export {
  OpenAiCompatibleEmbeddingClient,
} from "./openai-compatible-embedding.js";
export {
  SqliteDocumentStore,
} from "./storage/sqlite-document-store.js";
export {
  QdrantVectorStore,
} from "./storage/qdrant-vector-store.js";
export {
  Neo4jGraphStore,
} from "./storage/neo4j-graph-store.js";
~~~

这些内容追加到原有导出后面，不要覆盖第一阶段已有导出。

### Step 23：创建生产版示例

创建 `src/examples/production-memory-demo.ts`：

~~~ts
import "dotenv/config";
import { FunctionCallAgent } from "../agents/function-call/function-call-agent.js";
import { HelloAgentsLlm } from "../core/hello-agents-llm.js";
import {
  createProductionMemoryManager,
  loadProductionMemoryConfig,
} from "../memory/index.js";
import { createDefaultToolRegistry } from "../tools/create-default-registry.js";

async function main(): Promise<void> {
  const runtime = await createProductionMemoryManager({
    userId: "user-123",
    infrastructure: loadProductionMemoryConfig(),
  });

  try {
    const tools = createDefaultToolRegistry({
      includeSearch: false,
      memoryManager: runtime.manager,
    });
    const agent = new FunctionCallAgent({
      name: "持久化记忆助手",
      llm: new HelloAgentsLlm(),
      toolRegistry: tools,
      enableToolCalling: true,
      maxToolIterations: 6,
      systemPrompt: [
        "你是一个具有持久化记忆能力的助手。",
        "用户明确要求记住信息时调用 memory add。",
        "回答用户偏好或历史问题前调用 memory search。",
        "不要保存密码、令牌、身份证号等敏感数据。",
      ].join(""),
    });

    console.log((await agent.run("请记住我正在学习 Neo4j")).answer);
    console.log((await agent.run("我正在学习什么？")).answer);
  } finally {
    await runtime.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
~~~

在 `package.json` 增加：

~~~json
"demo:memory:production": "tsx src/examples/production-memory-demo.ts",
"test:memory:integration": "RUN_MEMORY_INTEGRATION_TESTS=true vitest run tests/*.integration.test.ts"
~~~

Windows 环境不支持直接在 script 前写环境变量时，可以安装 `cross-env`，然后改为：

~~~json
"test:memory:integration": "cross-env RUN_MEMORY_INTEGRATION_TESTS=true vitest run tests/*.integration.test.ts"
~~~

### Step 24：验证跨存储一致性

#### 24.1 先理解当前一致性边界

`StoredMemory.storeItem()` 当前写入顺序是：

~~~text
SQLite documents.add()
        │
        ▼
Embedding API
        │
        ▼
Qdrant vectors.upsert()
~~~

如果 Embedding 或 Qdrant 写入抛错，现有代码会执行：

~~~ts
await this.documents.delete(parsed.id);
~~~

因此“请求明确失败”的情况下可以完成补偿回滚。但是三个后端不存在共同事务，进程如果恰好在 SQLite 写入后崩溃，仍然可能留下没有向量的文档。第一版生产适配器接受这个边界，并通过一致性扫描修复；不要声称它具有强事务一致性。

#### 24.2 编写向量失败回滚测试

创建 `tests/stored-memory-consistency.test.ts`：

~~~ts
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { HashEmbeddingClient } from "../src/memory/embedding.js";
import type { MemoryItem } from "../src/memory/schemas.js";
import { SqliteDocumentStore } from "../src/memory/storage/sqlite-document-store.js";
import type {
  VectorRecord,
  VectorSearchFilter,
  VectorStore,
} from "../src/memory/storage/vector-store.js";
import type { VectorHit } from "../src/memory/storage/vector-store.js";
import { EpisodicMemory } from "../src/memory/types/episodic-memory.js";

class FailingVectorStore implements VectorStore {
  public async upsert(_records: VectorRecord[]): Promise<void> {
    throw new Error("模拟 Qdrant 写入失败");
  }

  public async search(
    _vector: number[],
    _limit: number,
    _filter?: VectorSearchFilter,
  ): Promise<VectorHit[]> {
    return [];
  }

  public async delete(_ids: string[]): Promise<void> {}

  public async clear(_filter?: VectorSearchFilter): Promise<void> {}
}

describe("StoredMemory consistency", () => {
  const databases: Database.Database[] = [];

  afterEach(() => {
    for (const database of databases) database.close();
    databases.length = 0;
  });

  it("Qdrant 写入失败时回滚 SQLite 文档", async () => {
    const database = new Database(":memory:");
    databases.push(database);

    const documents = new SqliteDocumentStore(database);
    const memory = new EpisodicMemory(
      documents,
      new FailingVectorStore(),
      new HashEmbeddingClient(8),
    );
    const item: MemoryItem = {
      id: "memory-1",
      content: "需要保持一致性的记忆",
      memoryType: "episodic",
      userId: "user-1",
      timestamp: "2026-08-19T10:00:00.000Z",
      importance: 0.8,
      metadata: {},
    };

    await expect(memory.add(item)).rejects.toThrow("模拟 Qdrant 写入失败");
    expect(await documents.get(item.id)).toBeUndefined();
  });
});
~~~

这个测试使用真实 SQLite 和失败替身，不调用外部 Embedding API、Qdrant 或 Neo4j，能够稳定验证补偿逻辑。

#### 24.3 删除一致性测试

对语义记忆做真实集成测试：

~~~text
1. 添加 semantic memory。
2. 在 SQLite 中确认文档存在。
3. 在 Qdrant 中按 memoryId 确认 point 存在。
4. 在 Neo4j 中按 memoryId 确认关系存在。
5. 调用 semanticMemory.remove(memoryId)。
6. 再次确认三个后端都不存在该 memoryId。
~~~

这里要注意当前删除顺序：

~~~text
Qdrant delete → SQLite delete → Neo4j delete
~~~

如果中途失败，应该记录错误并让一致性扫描重试。不要在删除失败后返回成功。

#### 24.4 后续增加一致性扫描器

第一轮升级完成后，再增加一个独立维护任务：

~~~ts
interface MemoryConsistencyReport {
  missingVectorIds: string[];
  orphanVectorIds: string[];
  orphanGraphMemoryIds: string[];
}
~~~

扫描器以 SQLite 为权威来源：

1. SQLite 有文档、Qdrant 无向量：重新生成 Embedding 并 upsert。
2. Qdrant 有向量、SQLite 无文档：删除孤立 point。
3. Neo4j 有关系、SQLite 无文档：调用 `deleteByMemoryId()`。

如果系统需要严格审计，不要直接删除，先把修复动作写入 outbox 表：

~~~sql
CREATE TABLE memory_outbox (
  id TEXT PRIMARY KEY,
  memory_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  last_error TEXT
);
~~~

outbox 属于第二阶段完成后的可靠性增强，不要在四个适配器尚未分别通过测试前提前实现。

### Step 25：第二阶段最终验收

先运行不依赖外部服务的测试：

~~~bash
npm run typecheck
npm test
~~~

再启动 Qdrant 和 Neo4j：

~~~bash
docker compose -f docker-compose.memory.yml up -d
~~~

设置真实测试环境后执行：

~~~bash
npm run test:memory:integration
npm run demo:memory:production
~~~

最终检查清单：

~~~text
配置
[ ] 缺少密钥或连接地址时启动立即失败
[ ] Embedding dimension 与 Qdrant collection 一致
[ ] .env、SQLite 文件和数据库数据目录没有提交到 Git

SQLite
[ ] MemoryItem 可以完整往返
[ ] userId、memoryType、timestamp 过滤正确
[ ] metadata 读取后通过 Zod 校验
[ ] userId + memoryType 和 timestamp 已建立索引

Embedding
[ ] 空文本被拒绝
[ ] 批量结果按 index 恢复顺序
[ ] 返回维度得到验证
[ ] 普通单元测试不会调用真实 API

Qdrant
[ ] collection 自动创建
[ ] userId、memoryType、modality 建 payload index
[ ] 每次搜索都把用户过滤下推到 Qdrant
[ ] upsert 和 delete 使用 wait=true
[ ] point ID 使用 UUID

Neo4j
[ ] 实体和关系都带 userId
[ ] 查询起点、路径终点和关系都限制当前用户
[ ] 动态业务关系保存在 type 属性，而不是拼接 Cypher
[ ] 删除记忆后关系和孤立实体得到清理

一致性
[ ] 向量写入失败会回滚 SQLite 文档
[ ] 语义记忆删除后 SQLite、Qdrant、Neo4j 都不存在目标 ID
[ ] 应用退出时 SQLite 和 Neo4j Driver 被关闭
[ ] 明确理解当前是补偿式最终一致性，不是分布式强事务

架构
[ ] createInMemoryMemoryManager 仍可独立运行
[ ] MemoryManager、MemoryTool 和 Agent 无结构性改动
[ ] 生产基础设施只通过端口适配器接入
~~~

第二阶段完成后，系统的核心业务调用方式仍然保持不变：

~~~ts
const tools = createDefaultToolRegistry({
  memoryManager: runtime.manager,
});
~~~

这正是端口与适配器架构的价值：领域层只理解“文档存储、向量存储、图存储和嵌入”这四种能力，不依赖 SQLite、Qdrant、Neo4j 或任意 Embedding 厂商的具体 SDK。

本节涉及的 SDK 用法应以对应版本的官方文档为准：

- better-sqlite3 API：https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md
- Qdrant JavaScript SDK：https://github.com/qdrant/qdrant-js
- Qdrant Points 与过滤：https://qdrant.tech/documentation/concepts/points/
- Neo4j JavaScript Driver：https://neo4j.com/docs/javascript-manual/current/
- SiliconFlow Embeddings：https://docs.siliconflow.com/en/api-reference/embeddings/create-embeddings
- SiliconFlow Qwen3-Embedding-0.6B：https://www.siliconflow.com/zh/models/qwen3-embedding-0-6b
