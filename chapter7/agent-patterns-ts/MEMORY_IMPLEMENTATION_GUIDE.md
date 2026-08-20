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
MEMORY_OUTBOX_MAX_ATTEMPTS=5

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
  MEMORY_OUTBOX_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),

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

这个测试验证 `SemanticMemory.remove()` 的成功路径是否真的清除了三个后端。
不要通过 `semanticMemory.retrieve()` 判断是否删除成功，因为检索为空只能说明
“没有检索到”，不能证明 SQLite 行、Qdrant point 和 Neo4j relation 已经物理删除。

测试采用以下组合：

~~~text
SQLite：真实 better-sqlite3，使用 :memory: 数据库
Qdrant：真实本地 Qdrant 服务
Neo4j：真实本地 Neo4j 服务
Embedding：HashEmbeddingClient，不调用外部 API
~~~

这里使用 `HashEmbeddingClient` 是刻意的：本测试的目标是验证跨存储删除，
不是验证 SiliconFlow 或其他 Embedding 服务。这样测试更快、无费用，也不会因为
外部模型服务波动而失败。

##### 24.3.1 启动外部服务

先启动 Qdrant 和 Neo4j：

~~~bash
docker compose -f docker-compose.memory.yml up -d
docker compose -f docker-compose.memory.yml ps
~~~

确认 Qdrant 可访问：

~~~bash
curl http://127.0.0.1:6333/collections
~~~

测试读取以下环境变量：

~~~dotenv
QDRANT_URL=http://127.0.0.1:6333
QDRANT_API_KEY=

NEO4J_URI=bolt://127.0.0.1:7687
NEO4J_USERNAME=neo4j
NEO4J_PASSWORD=change-me-in-local-env
NEO4J_DATABASE=neo4j
~~~

这个测试不需要 `EMBEDDING_API_KEY`。

##### 24.3.2 创建测试文件

创建 `tests/semantic-delete-consistency.integration.test.ts`：

~~~ts
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { QdrantClient } from "@qdrant/js-client-rest";
import Database from "better-sqlite3";
import neo4j, { type Driver } from "neo4j-driver";
import { describe, expect, it } from "vitest";
import { HashEmbeddingClient } from "../src/memory/embedding.js";
import { RuleBasedKnowledgeExtractor } from "../src/memory/knowledge-extractor.js";
import type { MemoryItem } from "../src/memory/schemas.js";
import { Neo4jGraphStore } from "../src/memory/storage/neo4j-graph-store.js";
import { QdrantVectorStore } from "../src/memory/storage/qdrant-vector-store.js";
import { SqliteDocumentStore } from "../src/memory/storage/sqlite-document-store.js";
import { SemanticMemory } from "../src/memory/types/semantic-memory.js";

/*
 * 普通 npm test 不应该依赖本地数据库服务。
 * 只有显式设置 RUN_MEMORY_INTEGRATION_TESTS=true 时才执行。
 */
const describeIntegration =
  process.env.RUN_MEMORY_INTEGRATION_TESTS === "true"
    ? describe
    : describe.skip;

async function countGraphRelations(
  driver: Driver,
  database: string,
  memoryId: string,
): Promise<number> {
  const result = await driver.executeQuery(
    [
      "MATCH ()-[edge:MEMORY_RELATION {memoryId: $memoryId}]->()",
      "RETURN count(edge) AS count",
    ].join("\n"),
    { memoryId },
    { database },
  );

  const value = result.records[0]?.get("count");

  if (neo4j.isInt(value)) {
    return value.toNumber();
  }

  return Number(value ?? 0);
}

describeIntegration(
  "SemanticMemory delete consistency integration",
  () => {
    it("删除语义记忆后 SQLite、Qdrant 和 Neo4j 都不存在目标 ID", async () => {
      /*
       * 每次测试使用独立 userId 和 collection，
       * 避免污染开发数据，也避免并发测试互相干扰。
       */
      const userId = `test-user-${randomUUID()}`;
      const memoryId = randomUUID();
      const collectionName =
        `test_semantic_delete_${randomUUID().replaceAll("-", "_")}`;
      const dimension = 64;
      const neo4jDatabase =
        process.env.NEO4J_DATABASE ?? "neo4j";

      /*
       * SQLite 使用真实数据库引擎，但数据库只存在于本测试进程内。
       * 测试结束关闭连接后自动消失。
       */
      const sqlite = new Database(":memory:");
      const documents = new SqliteDocumentStore(sqlite);

      const qdrant = new QdrantClient({
        url:
          process.env.QDRANT_URL ??
          "http://127.0.0.1:6333",
        ...(process.env.QDRANT_API_KEY
          ? { apiKey: process.env.QDRANT_API_KEY }
          : {}),
      });
      const vectors = new QdrantVectorStore({
        client: qdrant,
        collectionName,
        dimension,
      });

      const driver = neo4j.driver(
        process.env.NEO4J_URI ??
          "bolt://127.0.0.1:7687",
        neo4j.auth.basic(
          process.env.NEO4J_USERNAME ?? "neo4j",
          process.env.NEO4J_PASSWORD ??
            "change-me-in-local-env",
        ),
      );
      const graph = new Neo4jGraphStore({
        driver,
        database: neo4jDatabase,
      });

      const memory = new SemanticMemory(
        documents,
        vectors,
        new HashEmbeddingClient(dimension),
        graph,
        new RuleBasedKnowledgeExtractor(),
      );

      /*
       * 这段内容必须能被 RuleBasedKnowledgeExtractor
       * 提取出实体和关系。
       *
       * “用户喜欢TypeScript”会生成 LIKES 关系；
       * 如果只写一个没有关系的普通句子，Neo4j 中可能只有实体，
       * 无法完成 relation 的删除断言。
       */
      const item: MemoryItem = {
        id: memoryId,
        content: "用户喜欢TypeScript",
        memoryType: "semantic",
        userId,
        timestamp: "2026-08-20T10:00:00.000Z",
        importance: 0.9,
        metadata: {
          source: "semantic-delete-consistency-test",
        },
      };

      try {
        /*
         * 构造函数不能 await，所以在真正写数据前，
         * 显式等待 Qdrant collection、payload index
         * 和 Neo4j constraint 初始化完成。
         */
        await vectors.initialize();
        await driver.verifyConnectivity();
        await graph.initialize();

        // 第一步：通过 SemanticMemory 写入三个后端。
        await memory.add(item);

        /*
         * 第二步：直接检查 SQLite。
         * SemanticMemory.add() 会补充 entityIds 元数据，
         * 所以这里使用 toMatchObject，而不是与原 item 完全相等。
         */
        const storedDocument = await documents.get(memoryId);

        expect(storedDocument).toMatchObject({
          id: memoryId,
          userId,
          memoryType: "semantic",
          content: "用户喜欢TypeScript",
        });
        expect(storedDocument?.metadata.entityIds).toEqual(
          expect.any(Array),
        );

        // 第三步：绕过 VectorStore 搜索，按 ID 直接检查 Qdrant point。
        const pointsBeforeDelete = await qdrant.retrieve(
          collectionName,
          {
            ids: [memoryId],
            with_payload: true,
            with_vector: false,
          },
        );

        expect(pointsBeforeDelete).toHaveLength(1);
        expect(pointsBeforeDelete[0]?.id).toBe(memoryId);
        expect(pointsBeforeDelete[0]?.payload).toMatchObject({
          memoryId,
          userId,
          memoryType: "semantic",
        });

        // 第四步：通过 Cypher 按 memoryId 直接检查 Neo4j 关系。
        const graphRelationsBeforeDelete =
          await countGraphRelations(
            driver,
            neo4jDatabase,
            memoryId,
          );

        expect(graphRelationsBeforeDelete).toBeGreaterThan(0);

        // 第五步：只调用领域对象的 remove，不直接删除三个后端。
        const removed = await memory.remove(memoryId);

        expect(removed).toBe(true);

        // 第六步：再次直接检查 SQLite。
        expect(await documents.get(memoryId)).toBeUndefined();
        expect(await memory.has(memoryId)).toBe(false);

        // 第七步：再次按 ID 检查 Qdrant。
        const pointsAfterDelete = await qdrant.retrieve(
          collectionName,
          {
            ids: [memoryId],
            with_payload: true,
            with_vector: false,
          },
        );

        expect(pointsAfterDelete).toEqual([]);

        // 第八步：再次检查 Neo4j。
        const graphRelationsAfterDelete =
          await countGraphRelations(
            driver,
            neo4jDatabase,
            memoryId,
          );

        expect(graphRelationsAfterDelete).toBe(0);
      } finally {
        /*
         * 即使中间断言失败，也尽量清理本测试创建的数据。
         * allSettled 防止一个清理失败阻止其他资源释放。
         */
        await Promise.allSettled([
          graph.clear(userId),
          qdrant.deleteCollection(collectionName),
        ]);

        await driver.close();
        sqlite.close();
      }
    }, 60_000);
  },
);
~~~

##### 24.3.3 理解测试中的三个“直接检查”

SQLite 直接检查：

~~~ts
await documents.get(memoryId);
~~~

这里验证 `memories` 表中是否还有该主键。

Qdrant 直接检查：

~~~ts
await qdrant.retrieve(collectionName, {
  ids: [memoryId],
  with_payload: true,
  with_vector: false,
});
~~~

不要使用相似度搜索验证删除，因为搜索结果会受到 query、score、limit 和 filter
影响。按 point ID 查询才能证明目标 point 是否存在。

Neo4j 直接检查：

~~~cypher
MATCH ()-[edge:MEMORY_RELATION {memoryId: $memoryId}]->()
RETURN count(edge) AS count
~~~

这里检查的是保存该语义记忆的关系数量。删除前必须大于 0，删除后必须等于 0。

##### 24.3.4 运行单个测试

macOS/Linux：

~~~bash
RUN_MEMORY_INTEGRATION_TESTS=true npx vitest run tests/semantic-delete-consistency.integration.test.ts
~~~

也可以运行全部数据库集成测试：

~~~bash
npm run test:memory:integration
~~~

普通测试仍然不会连接 Qdrant 和 Neo4j：

~~~bash
npm test
~~~

因为没有设置 `RUN_MEMORY_INTEGRATION_TESTS=true`，该测试会显示为 skipped。

##### 24.3.5 正确理解这个测试覆盖了什么

当前 `SemanticMemory.remove()` 的成功路径是：

~~~text
Qdrant delete → SQLite delete → Neo4j delete
~~~

这个集成测试证明：三个操作都成功时，三个后端最终都不存在目标
`memoryId`。

它还没有证明中途失败时能够自动恢复。例如：

~~~text
Qdrant 删除成功
→ SQLite 删除成功
→ Neo4j 删除失败
~~~

这种情况下 `SemanticMemory.remove()` 会抛出异常，而不是返回成功；但是已经完成的
Qdrant 和 SQLite 删除不能自动回滚。后续一致性扫描器需要根据 SQLite 权威数据和
删除任务记录，重试 Neo4j 清理。不要把这个成功路径测试误认为分布式事务测试。

#### 24.4 后续增加一致性扫描器

这一节不要放进 `SemanticMemory`。`SemanticMemory` 负责在线读写；一致性扫描器是一个
低频运行的维护任务，负责比较三个后端的物理状态并修复漂移。

第一版按下面的边界实现：

~~~text
SQLite：权威来源（source of truth）
Qdrant：可由 SQLite 文档重新生成的派生数据
Neo4j：可清理的语义关系索引
~~~

这里有一个容易误解的地方：当前报告只检查“孤立图关系”，不检查“缺失图关系”。
一条 semantic memory 不一定能抽取出实体和关系，因此不能仅凭 SQLite 中有文档就断言
Neo4j 中一定应该有关系。若以后要修复缺失图关系，需要额外保存“抽取是否成功、抽取版本、
期望关系数量”等状态，不能在这一版中猜测。

##### 24.4.1 实现前的验收条件

开始本节前，先确保下面的测试分别通过：

~~~bash
npm run typecheck
npm test
docker compose -f docker-compose.memory.yml up -d
npm run test:memory:integration
~~~

第一版扫描器还没有快照或分布式锁。运行扫描时不要同时执行记忆写入、更新和删除，推荐在
开发环境或维护窗口中运行。否则扫描器可能把一个尚未完成的正常写入误认为短暂不一致。

##### 24.4.2 新增维护接口

现有 `VectorStore` 只支持检索，没有枚举所有 point ID 的能力；现有 `GraphStore` 也没有
枚举所有关系 `memoryId` 的能力。不要为了维护任务扩大在线存储接口，新增
`src/memory/consistency/consistency-store.ts`：

~~~ts
import type { VectorRecord } from "../storage/vector-store.js";

/**
 * 扫描器只依赖它真正需要的 Qdrant 能力。
 * 这样 VectorStore 的在线检索接口不需要知道维护任务。
 */
export interface ConsistencyVectorStore {
  listMemoryIds(userId?: string): Promise<string[]>;
  upsert(records: VectorRecord[]): Promise<void>;
  delete(ids: string[]): Promise<void>;
}

/** Neo4j 维护任务需要的最小接口。 */
export interface ConsistencyGraphStore {
  listMemoryIds(userId?: string): Promise<string[]>;
  deleteByMemoryId(memoryId: string): Promise<void>;
}
~~~

这里使用 TypeScript 的结构化类型：`QdrantVectorStore` 只要拥有这些方法，就可以传给
扫描器，不必显式写 `implements ConsistencyVectorStore`。测试替身也只需实现三个或两个
方法。

##### 24.4.3 给 Qdrant 适配器增加分页枚举

在 `src/memory/storage/qdrant-vector-store.ts` 的 `QdrantVectorStore` 类中增加下面的方法：

~~~ts
public async listMemoryIds(userId?: string): Promise<string[]> {
  await this.ready;

  const ids = new Set<string>();
  let offset: string | number | undefined;

  do {
    const page = await this.options.client.scroll(
      this.options.collectionName,
      {
        limit: 256,
        ...(offset === undefined ? {} : { offset }),
        ...(userId
          ? {
              filter: {
                must: [
                  {
                    key: "userId",
                    match: { value: userId },
                  },
                ],
              },
            }
          : {}),
        with_payload: true,
        with_vector: false,
      },
    );

    for (const point of page.points) {
      const memoryId = point.payload?.memoryId;

      if (typeof memoryId !== "string" || memoryId.length === 0) {
        throw new Error(
          `Qdrant point 缺少合法 memoryId：${String(point.id)}`,
        );
      }

      /*
       * 当前项目约定 Qdrant point.id 与 payload.memoryId 都等于记忆 ID。
       * 不满足约定的 point 不能安全地交给 delete([memoryId]) 修复。
       */
      if (String(point.id) !== memoryId) {
        throw new Error(
          `Qdrant point ID 与 memoryId 不一致：${String(point.id)} != ${memoryId}`,
        );
      }

      ids.add(memoryId);
    }

    const nextOffset = page.next_page_offset;
    offset =
      typeof nextOffset === "string" || typeof nextOffset === "number"
        ? nextOffset
        : undefined;
  } while (offset !== undefined);

  return [...ids].sort();
}
~~~

关键点：

1. 必须使用 `scroll()` 分页，不能用一次向量搜索代替全量扫描。
2. `with_vector: false` 可以避免把 1024/1536 维向量通过网络全部传回来。
3. 必须读取 payload 中的 `memoryId`。当前 collection 是记忆专用 collection，发现没有
   `memoryId` 的 point 说明数据违反约定，应让扫描失败并人工确认，不能悄悄跳过。
4. 代码假设这个 collection 专用于当前记忆系统，并坚持 `point.id === memoryId`。
5. `userId` 存在时使用 Qdrant payload filter，便于按租户分批扫描。

##### 24.4.4 给 Neo4j 适配器增加关系 ID 枚举

在 `src/memory/storage/neo4j-graph-store.ts` 的 `Neo4jGraphStore` 类中增加：

~~~ts
public async listMemoryIds(userId?: string): Promise<string[]> {
  await this.ready;

  const result = await this.options.driver.executeQuery(
    [
      "MATCH ()-[edge:MEMORY_RELATION]->()",
      "WHERE $userId IS NULL OR edge.userId = $userId",
      "RETURN DISTINCT edge.memoryId AS memoryId",
      "ORDER BY memoryId",
    ].join("\n"),
    { userId: userId ?? null },
    { database: this.options.database },
  );

  return result.records
    .map((record) => record.get("memoryId"))
    .filter(
      (memoryId): memoryId is string =>
        typeof memoryId === "string" && memoryId.length > 0,
    );
}
~~~

这里必须使用 `DISTINCT`。一条语义记忆可能生成多条关系，报告关心的是出现不一致的
记忆 ID，而不是关系数量。

##### 24.4.5 统一生成 VectorRecord

补向量时必须生成与正常写入完全相同的 payload。为了避免在线写入和扫描修复各复制一份
映射逻辑，新建 `src/memory/memory-vector-record.ts`：

~~~ts
import type { MemoryItem } from "./schemas.js";
import type { VectorRecord } from "./storage/vector-store.js";

export function createMemoryVectorRecord(
  item: MemoryItem,
  vector: number[],
): VectorRecord {
  return {
    id: item.id,
    vector,
    metadata: {
      ...item.metadata,
      memoryId: item.id,
      userId: item.userId,
      memoryType: item.memoryType,
      importance: item.importance,
    },
  };
}
~~~

这里把 `item.metadata` 放在前面，把系统保留字段放在后面。这样调用者即使在 metadata
里传入同名键，也不能覆盖 `memoryId`、`userId`、`memoryType` 和 `importance`。

然后修改 `src/memory/types/stored-memory.ts`：

~~~ts
import { createMemoryVectorRecord } from "../memory-vector-record.js";
~~~

把 `storeItem()` 中的 `upsert` 参数替换为：

~~~ts
await this.vectors.upsert([
  createMemoryVectorRecord(parsed, vector),
]);
~~~

把 `update()` 中写入新向量的参数替换为：

~~~ts
await this.vectors.upsert([
  createMemoryVectorRecord(updated, vector),
]);
~~~

把 `update()` 回滚旧向量时的参数替换为：

~~~ts
await this.vectors.upsert([
  createMemoryVectorRecord(current, oldVector),
]);
~~~

这三个位置都要替换。完成后先运行：

~~~bash
npm run typecheck
npm test
~~~

##### 24.4.6 定义报告、修复结果和错误

新建 `src/memory/consistency/memory-consistency-types.ts`：

~~~ts
export interface MemoryConsistencyReport {
  /** SQLite 有文档，Qdrant 没有对应 point。 */
  missingVectorIds: string[];

  /** Qdrant 有 point，SQLite 没有对应文档。 */
  orphanVectorIds: string[];

  /** Neo4j 有关系，SQLite 没有对应文档。 */
  orphanGraphMemoryIds: string[];
}

export interface MemoryConsistencyRepairFailure {
  memoryId: string;
  operation: "UPSERT_VECTOR" | "DELETE_VECTOR" | "DELETE_GRAPH";
  message: string;
}

export interface MemoryConsistencyRepairResult {
  before: MemoryConsistencyReport;
  repairedVectorIds: string[];
  deletedVectorIds: string[];
  deletedGraphMemoryIds: string[];
  failures: MemoryConsistencyRepairFailure[];
  after: MemoryConsistencyReport;
}

function countInconsistencies(report: MemoryConsistencyReport): number {
  return (
    report.missingVectorIds.length +
    report.orphanVectorIds.length +
    report.orphanGraphMemoryIds.length
  );
}

export class MemoryConsistencyRepairError extends Error {
  public constructor(
    public readonly result: MemoryConsistencyRepairResult,
  ) {
    super(
      [
        "记忆一致性修复未完全成功：",
        `${result.failures.length} 个操作失败，`,
        `${countInconsistencies(result.after)} 个不一致仍然存在`,
      ].join(""),
    );
    this.name = "MemoryConsistencyRepairError";
  }
}
~~~

`scan()` 只返回发现的问题；`repair()` 返回做过哪些动作。错误对象携带完整结果，是为了
满足“中途失败不能返回成功”：调用者既能收到失败，也能记录哪些操作已经完成。

##### 24.4.7 实现基础扫描器

新建 `src/memory/consistency/memory-consistency-scanner.ts`：

~~~ts
import type { EmbeddingClient } from "../embedding.js";
import { createMemoryVectorRecord } from "../memory-vector-record.js";
import type { DocumentStore } from "../storage/document-store.js";
import type {
  ConsistencyGraphStore,
  ConsistencyVectorStore,
} from "./consistency-store.js";
import {
  MemoryConsistencyRepairError,
  type MemoryConsistencyRepairFailure,
  type MemoryConsistencyRepairResult,
  type MemoryConsistencyReport,
} from "./memory-consistency-types.js";

export interface MemoryConsistencyScanOptions {
  /** 不传表示扫描全部用户；生产环境推荐每次只扫描一个用户。 */
  userId?: string;
}

function difference(left: Set<string>, right: Set<string>): string[] {
  return [...left].filter((id) => !right.has(id)).sort();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class MemoryConsistencyScanner {
  public constructor(
    private readonly documents: DocumentStore,
    private readonly vectors: ConsistencyVectorStore,
    private readonly graph: ConsistencyGraphStore,
    private readonly embeddings: EmbeddingClient,
  ) {}

  /**
   * 只读操作：取得三个后端的 ID 快照并计算集合差集。
   */
  public async scan(
    options: MemoryConsistencyScanOptions = {},
  ): Promise<MemoryConsistencyReport> {
    const [documents, vectorIds, graphMemoryIds] = await Promise.all([
      this.documents.list(
        options.userId ? { userId: options.userId } : {},
      ),
      this.vectors.listMemoryIds(options.userId),
      this.graph.listMemoryIds(options.userId),
    ]);

    const documentIds = new Set(documents.map((item) => item.id));
    const vectorIdSet = new Set(vectorIds);
    const graphMemoryIdSet = new Set(graphMemoryIds);

    return {
      missingVectorIds: difference(documentIds, vectorIdSet),
      orphanVectorIds: difference(vectorIdSet, documentIds),
      orphanGraphMemoryIds: difference(graphMemoryIdSet, documentIds),
    };
  }

  /**
   * 基础版直接修复。每个 ID 独立处理，一个失败不会阻止其他 ID 被尝试。
   * 所有操作结束后会重新扫描；只要出现异常，就抛出 RepairError。
   */
  public async scanAndRepair(
    options: MemoryConsistencyScanOptions = {},
  ): Promise<MemoryConsistencyRepairResult> {
    const before = await this.scan(options);
    const repairedVectorIds: string[] = [];
    const deletedVectorIds: string[] = [];
    const deletedGraphMemoryIds: string[] = [];
    const failures: MemoryConsistencyRepairFailure[] = [];

    for (const memoryId of before.missingVectorIds) {
      try {
        /* 文档可能在 scan() 后被删除，所以修复前必须重新读取。 */
        const item = await this.documents.get(memoryId);
        if (!item) continue;

        const vector = await this.embeddings.embed(item.content);
        await this.vectors.upsert([
          createMemoryVectorRecord(item, vector),
        ]);
        repairedVectorIds.push(memoryId);
      } catch (error: unknown) {
        failures.push({
          memoryId,
          operation: "UPSERT_VECTOR",
          message: errorMessage(error),
        });
      }
    }

    for (const memoryId of before.orphanVectorIds) {
      try {
        /* scan() 后若同 ID 文档已创建，就不能再把它的向量删掉。 */
        if (await this.documents.get(memoryId)) continue;

        /* delete 必须是幂等操作；point 已不存在也应该视为成功。 */
        await this.vectors.delete([memoryId]);
        deletedVectorIds.push(memoryId);
      } catch (error: unknown) {
        failures.push({
          memoryId,
          operation: "DELETE_VECTOR",
          message: errorMessage(error),
        });
      }
    }

    for (const memoryId of before.orphanGraphMemoryIds) {
      try {
        /* 重新检查 SQLite 权威状态，避免删除刚刚恢复为有效的关系。 */
        if (await this.documents.get(memoryId)) continue;

        await this.graph.deleteByMemoryId(memoryId);
        deletedGraphMemoryIds.push(memoryId);
      } catch (error: unknown) {
        failures.push({
          memoryId,
          operation: "DELETE_GRAPH",
          message: errorMessage(error),
        });
      }
    }

    const after = await this.scan(options);
    const result: MemoryConsistencyRepairResult = {
      before,
      repairedVectorIds,
      deletedVectorIds,
      deletedGraphMemoryIds,
      failures,
      after,
    };

    const hasRemainingInconsistency =
      after.missingVectorIds.length > 0 ||
      after.orphanVectorIds.length > 0 ||
      after.orphanGraphMemoryIds.length > 0;

    if (failures.length > 0 || hasRemainingInconsistency) {
      throw new MemoryConsistencyRepairError(result);
    }

    return result;
  }
}
~~~

算法本质是三个集合的差集：

~~~text
missingVectorIds      = SQLite IDs - Qdrant IDs
orphanVectorIds       = Qdrant IDs - SQLite IDs
orphanGraphMemoryIds  = Neo4j memoryIds - SQLite IDs
~~~

`Promise.all()` 只并行读取三个快照；修复阶段按 ID 顺序执行，便于观察错误和限制外部服务
压力。数据量大以后再增加 batch size 和并发上限，不要直接使用无限并发的
`Promise.all(ids.map(...))`。

##### 24.4.8 导出维护模块

在 `src/memory/index.ts` 最后增加：

~~~ts
export {
  MemoryConsistencyScanner,
} from "./consistency/memory-consistency-scanner.js";
export type {
  MemoryConsistencyScanOptions,
} from "./consistency/memory-consistency-scanner.js";
export {
  MemoryConsistencyRepairError,
} from "./consistency/memory-consistency-types.js";
export type {
  MemoryConsistencyRepairFailure,
  MemoryConsistencyRepairResult,
  MemoryConsistencyReport,
} from "./consistency/memory-consistency-types.js";
~~~

`ConsistencyVectorStore` 和 `ConsistencyGraphStore` 是内部维护端口，通常不需要从公共入口
导出。

##### 24.4.9 先写不依赖真实数据库的单元测试

创建 `tests/memory-consistency-scanner.test.ts`：

~~~ts
import { describe, expect, it } from "vitest";
import { HashEmbeddingClient } from "../src/memory/embedding.js";
import { MemoryConsistencyScanner } from "../src/memory/consistency/memory-consistency-scanner.js";
import { MemoryConsistencyRepairError } from "../src/memory/consistency/memory-consistency-types.js";
import { InMemoryDocumentStore } from "../src/memory/storage/document-store.js";
import type { VectorRecord } from "../src/memory/storage/vector-store.js";

class FakeConsistencyVectorStore {
  public readonly records = new Map<string, VectorRecord>();
  public failDeleteId?: string;

  public async listMemoryIds(): Promise<string[]> {
    return [...this.records.keys()].sort();
  }

  public async upsert(records: VectorRecord[]): Promise<void> {
    for (const record of records) {
      this.records.set(record.id, structuredClone(record));
    }
  }

  public async delete(ids: string[]): Promise<void> {
    for (const id of ids) {
      if (id === this.failDeleteId) {
        throw new Error(`模拟 Qdrant 删除失败：${id}`);
      }
      this.records.delete(id);
    }
  }
}

class FakeConsistencyGraphStore {
  public readonly memoryIds = new Set<string>();

  public async listMemoryIds(): Promise<string[]> {
    return [...this.memoryIds].sort();
  }

  public async deleteByMemoryId(memoryId: string): Promise<void> {
    this.memoryIds.delete(memoryId);
  }
}

describe("MemoryConsistencyScanner", () => {
  it("发现三类不一致并直接修复", async () => {
    const documents = new InMemoryDocumentStore();
    const vectors = new FakeConsistencyVectorStore();
    const graph = new FakeConsistencyGraphStore();
    const embeddings = new HashEmbeddingClient(8);
    const scanner = new MemoryConsistencyScanner(
      documents,
      vectors,
      graph,
      embeddings,
    );

    await documents.add({
      id: "missing-vector",
      content: "用户喜欢 TypeScript",
      memoryType: "semantic",
      userId: "user-1",
      timestamp: "2026-08-20T10:00:00.000Z",
      importance: 0.9,
      metadata: { source: "test" },
    });

    await vectors.upsert([
      {
        id: "orphan-vector",
        vector: new Array(8).fill(0),
        metadata: {
          memoryId: "orphan-vector",
          userId: "user-1",
          memoryType: "semantic",
        },
      },
    ]);
    graph.memoryIds.add("orphan-graph");

    await expect(scanner.scan()).resolves.toEqual({
      missingVectorIds: ["missing-vector"],
      orphanVectorIds: ["orphan-vector"],
      orphanGraphMemoryIds: ["orphan-graph"],
    });

    const result = await scanner.scanAndRepair();

    expect(result.repairedVectorIds).toEqual(["missing-vector"]);
    expect(result.deletedVectorIds).toEqual(["orphan-vector"]);
    expect(result.deletedGraphMemoryIds).toEqual(["orphan-graph"]);
    expect(result.failures).toEqual([]);
    expect(result.after).toEqual({
      missingVectorIds: [],
      orphanVectorIds: [],
      orphanGraphMemoryIds: [],
    });

    const repaired = vectors.records.get("missing-vector");
    expect(repaired?.vector).toHaveLength(8);
    expect(repaired?.metadata).toMatchObject({
      memoryId: "missing-vector",
      userId: "user-1",
      memoryType: "semantic",
      importance: 0.9,
      source: "test",
    });
  });

  it("修复失败时抛错且保留失败报告", async () => {
    const documents = new InMemoryDocumentStore();
    const vectors = new FakeConsistencyVectorStore();
    const graph = new FakeConsistencyGraphStore();
    const scanner = new MemoryConsistencyScanner(
      documents,
      vectors,
      graph,
      new HashEmbeddingClient(8),
    );

    await vectors.upsert([
      {
        id: "cannot-delete",
        vector: new Array(8).fill(0),
        metadata: { memoryId: "cannot-delete" },
      },
    ]);
    vectors.failDeleteId = "cannot-delete";

    try {
      await scanner.scanAndRepair();
      throw new Error("测试失败：scanAndRepair() 不应该返回成功");
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(MemoryConsistencyRepairError);

      const repairError = error as MemoryConsistencyRepairError;
      expect(repairError.result.failures).toEqual([
        {
          memoryId: "cannot-delete",
          operation: "DELETE_VECTOR",
          message: "模拟 Qdrant 删除失败：cannot-delete",
        },
      ]);
      expect(repairError.result.after.orphanVectorIds).toEqual([
        "cannot-delete",
      ]);
    }
  });
});
~~~

运行：

~~~bash
npx vitest run tests/memory-consistency-scanner.test.ts
npm run typecheck
~~~

第二个测试非常重要：它证明删除失败时方法会抛出异常，而不是打印一行日志后返回成功。

##### 24.4.10 做一次真实漂移演练

这一小节验证的不是测试替身，而是下面这条真实链路：

~~~text
真实 SQLite 引擎（:memory:）
        +
真实本地 Qdrant 服务
        +
真实本地 Neo4j 服务
        ↓
MemoryConsistencyScanner.scan()
        ↓
MemoryConsistencyScanner.scanAndRepair()
        ↓
直接读取三个后端确认物理结果
~~~

Embedding 仍使用 `HashEmbeddingClient`，因为本测试的目标是数据库一致性，不是验证外部
Embedding 厂商。这样无需消耗 SiliconFlow/OpenAI-compatible API 配额，也不会因为网络
波动导致一致性测试不稳定。

###### 24.4.10.1 确认前置代码已经完成

开始前确认已经完成 24.4.2～24.4.9，尤其是：

~~~text
[ ] QdrantVectorStore.listMemoryIds(userId?) 已实现
[ ] Neo4jGraphStore.listMemoryIds(userId?) 已实现
[ ] createMemoryVectorRecord() 已实现
[ ] MemoryConsistencyScanner 已实现
[ ] memory-consistency-scanner.test.ts 已通过
~~~

先执行：

~~~bash
npm run typecheck
npx vitest run tests/memory-consistency-scanner.test.ts
~~~

如果这里还没有通过，不要先写集成测试，否则很难判断错误来自扫描算法还是外部服务。

###### 24.4.10.2 启动 Qdrant 和 Neo4j

在 `chapter7/agent-patterns-ts` 目录执行：

~~~bash
docker compose -f docker-compose.memory.yml up -d
docker compose -f docker-compose.memory.yml ps
~~~

Qdrant 可以这样检查：

~~~bash
curl http://127.0.0.1:6333/collections
~~~

应返回 JSON，而不是连接失败。Neo4j 的 Bolt 默认地址是
`bolt://127.0.0.1:7687`。测试会调用 `driver.verifyConnectivity()` 做最终检查。

确保 `.env` 至少包含与 `docker-compose.memory.yml` 一致的连接信息：

~~~dotenv
QDRANT_URL=http://127.0.0.1:6333
QDRANT_API_KEY=

NEO4J_URI=bolt://127.0.0.1:7687
NEO4J_USERNAME=neo4j
NEO4J_PASSWORD=change-me-in-local-env
NEO4J_DATABASE=neo4j
~~~

如果你的 compose 文件使用了不同密码，以 compose 中的值为准。本测试不需要
`EMBEDDING_API_KEY`。

###### 24.4.10.3 明确三种漂移如何制造

不要通过 `SemanticMemory.add()` 注入这三条数据，因为领域对象会同时写多个后端，无法
稳定制造不一致。测试必须绕过领域对象，直接操作适配器：

~~~text
缺失向量：
SQLite        有 missingVectorId
Qdrant        无 missingVectorId

孤立向量：
SQLite        无 orphanVectorId
Qdrant        有 orphanVectorId

孤立图关系：
SQLite        无 orphanGraphId
Neo4j         有 memoryId = orphanGraphId 的关系
~~~

这里使用三个不同的 UUID。不要让三种漂移共用一个 ID，否则集合差集会互相影响，测试
无法精确证明每条修复分支都执行了。

###### 24.4.10.4 创建完整集成测试文件

创建 `tests/memory-consistency-scanner.integration.test.ts`，写入下面的完整代码：

~~~ts
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { QdrantClient } from "@qdrant/js-client-rest";
import Database from "better-sqlite3";
import neo4j, { type Driver } from "neo4j-driver";
import { describe, expect, it } from "vitest";
import { MemoryConsistencyScanner } from "../src/memory/consistency/memory-consistency-scanner.js";
import { HashEmbeddingClient } from "../src/memory/embedding.js";
import { Neo4jGraphStore } from "../src/memory/storage/neo4j-graph-store.js";
import { QdrantVectorStore } from "../src/memory/storage/qdrant-vector-store.js";
import { SqliteDocumentStore } from "../src/memory/storage/sqlite-document-store.js";

/*
 * 普通 npm test 不连接外部数据库。
 * 只有显式设置开关时才执行这组真实集成测试。
 */
const describeIntegration =
  process.env.RUN_MEMORY_INTEGRATION_TESTS === "true"
    ? describe
    : describe.skip;

/** 直接通过 Cypher 统计指定 memoryId 的真实关系数量。 */
async function countGraphRelations(
  driver: Driver,
  database: string,
  memoryId: string,
): Promise<number> {
  const result = await driver.executeQuery(
    [
      "MATCH ()-[edge:MEMORY_RELATION {memoryId: $memoryId}]->()",
      "RETURN count(edge) AS count",
    ].join("\n"),
    { memoryId },
    { database },
  );

  const value = result.records[0]?.get("count");

  /* Neo4j count() 返回 Integer，需要显式转换成普通 number。 */
  if (neo4j.isInt(value)) return value.toNumber();
  return Number(value ?? 0);
}

/** 直接检查指定 Qdrant point 是否存在，不通过 VectorStore.search()。 */
async function retrievePoint(
  client: QdrantClient,
  collectionName: string,
  memoryId: string,
) {
  return client.retrieve(collectionName, {
    ids: [memoryId],
    with_payload: true,
    with_vector: false,
  });
}

describeIntegration("MemoryConsistencyScanner integration", () => {
  it("发现并修复缺失向量、孤立向量和孤立图关系", async () => {
    /*
     * 每次执行都使用随机 userId、ID 和 collection。
     * 这样不会污染开发数据，并行测试之间也不会互相干扰。
     */
    const userId = `consistency-user-${randomUUID()}`;
    const missingVectorId = randomUUID();
    const orphanVectorId = randomUUID();
    const orphanGraphId = randomUUID();
    const graphSourceId = randomUUID();
    const graphTargetId = randomUUID();
    const graphRelationId = randomUUID();
    const collectionName =
      `test_memory_consistency_${randomUUID().replaceAll("-", "_")}`;
    const dimension = 64;
    const neo4jDatabase = process.env.NEO4J_DATABASE ?? "neo4j";

    /*
     * 使用真实 better-sqlite3 引擎，但数据库只存在于当前进程内。
     * sqlite.close() 后数据自动消失。
     */
    const sqlite = new Database(":memory:");
    const documents = new SqliteDocumentStore(sqlite);

    const qdrant = new QdrantClient({
      url: process.env.QDRANT_URL ?? "http://127.0.0.1:6333",
      ...(process.env.QDRANT_API_KEY
        ? { apiKey: process.env.QDRANT_API_KEY }
        : {}),
    });
    const vectors = new QdrantVectorStore({
      client: qdrant,
      collectionName,
      dimension,
    });

    const driver = neo4j.driver(
      process.env.NEO4J_URI ?? "bolt://127.0.0.1:7687",
      neo4j.auth.basic(
        process.env.NEO4J_USERNAME ?? "neo4j",
        process.env.NEO4J_PASSWORD ?? "change-me-in-local-env",
      ),
    );
    const graph = new Neo4jGraphStore({
      driver,
      database: neo4jDatabase,
    });

    const embeddings = new HashEmbeddingClient(dimension);
    const scanner = new MemoryConsistencyScanner(
      documents,
      vectors,
      graph,
      embeddings,
    );

    try {
      /*
       * Qdrant/Neo4j 的构造函数会启动异步初始化，
       * 注入测试数据之前要显式等待初始化完成。
       */
      await vectors.initialize();
      await driver.verifyConnectivity();
      await graph.initialize();

      /*
       * 第一步：只写 SQLite，制造“SQLite 有、Qdrant 无”。
       * 不能调用 SemanticMemory.add()，否则它会同时写入 Qdrant。
       */
      await documents.add({
        id: missingVectorId,
        content: "用户喜欢 TypeScript",
        memoryType: "semantic",
        userId,
        timestamp: "2026-08-20T10:00:00.000Z",
        importance: 0.9,
        metadata: {
          source: "consistency-integration",
        },
      });

      /*
       * 第二步：只写 Qdrant，制造“Qdrant 有、SQLite 无”。
       * point.id 和 payload.memoryId 必须遵守同 ID 约定。
       */
      await vectors.upsert([
        {
          id: orphanVectorId,
          vector: await embeddings.embed("这是一条孤立向量"),
          metadata: {
            memoryId: orphanVectorId,
            userId,
            memoryType: "semantic",
            importance: 0.5,
            source: "consistency-integration",
          },
        },
      ]);

      /*
       * 第三步：只写 Neo4j，制造“Neo4j 有关系、SQLite 无”。
       * addRelation() 要求源实体和目标实体已经存在。
       */
      await graph.addEntity({
        id: graphSourceId,
        userId,
        name: "用户",
        type: "person",
        properties: {},
      });
      await graph.addEntity({
        id: graphTargetId,
        userId,
        name: "TypeScript",
        type: "technology",
        properties: {},
      });
      await graph.addRelation({
        id: graphRelationId,
        userId,
        sourceId: graphSourceId,
        targetId: graphTargetId,
        type: "LIKES",
        memoryId: orphanGraphId,
        properties: {},
      });

      /*
       * 第四步：修复前先直接检查三个后端，证明漂移确实制造成功。
       */
      expect(await documents.get(missingVectorId)).toMatchObject({
        id: missingVectorId,
        userId,
        memoryType: "semantic",
      });
      expect(await documents.get(orphanVectorId)).toBeUndefined();
      expect(await documents.get(orphanGraphId)).toBeUndefined();

      expect(
        await retrievePoint(qdrant, collectionName, missingVectorId),
      ).toEqual([]);

      const orphanVectorBefore = await retrievePoint(
        qdrant,
        collectionName,
        orphanVectorId,
      );
      expect(orphanVectorBefore).toHaveLength(1);
      expect(orphanVectorBefore[0]?.payload).toMatchObject({
        memoryId: orphanVectorId,
        userId,
      });

      expect(
        await countGraphRelations(
          driver,
          neo4jDatabase,
          orphanGraphId,
        ),
      ).toBe(1);

      /*
       * 第五步：只读扫描必须精确报告三种漂移，不能修改数据。
       */
      const reportBefore = await scanner.scan({ userId });

      expect(reportBefore).toEqual({
        missingVectorIds: [missingVectorId],
        orphanVectorIds: [orphanVectorId],
        orphanGraphMemoryIds: [orphanGraphId],
      });

      /* 再检查一次孤立数据，证明 scan() 本身没有执行修复。 */
      expect(
        await retrievePoint(qdrant, collectionName, orphanVectorId),
      ).toHaveLength(1);
      expect(
        await countGraphRelations(
          driver,
          neo4jDatabase,
          orphanGraphId,
        ),
      ).toBe(1);

      /*
       * 第六步：执行基础版直接修复。
       */
      const repair = await scanner.scanAndRepair({ userId });

      expect(repair.before).toEqual(reportBefore);
      expect(repair.repairedVectorIds).toEqual([missingVectorId]);
      expect(repair.deletedVectorIds).toEqual([orphanVectorId]);
      expect(repair.deletedGraphMemoryIds).toEqual([orphanGraphId]);
      expect(repair.failures).toEqual([]);
      expect(repair.after).toEqual({
        missingVectorIds: [],
        orphanVectorIds: [],
        orphanGraphMemoryIds: [],
      });

      /*
       * 第七步：再次独立 scan，避免只相信 scanAndRepair() 返回的 after。
       */
      await expect(scanner.scan({ userId })).resolves.toEqual({
        missingVectorIds: [],
        orphanVectorIds: [],
        orphanGraphMemoryIds: [],
      });

      /*
       * 第八步：直接检查 SQLite。
       * 修复缺失向量不能删除或修改权威文档。
       */
      expect(await documents.get(missingVectorId)).toMatchObject({
        id: missingVectorId,
        content: "用户喜欢 TypeScript",
        userId,
        memoryType: "semantic",
        importance: 0.9,
        metadata: {
          source: "consistency-integration",
        },
      });
      expect(await documents.get(orphanVectorId)).toBeUndefined();
      expect(await documents.get(orphanGraphId)).toBeUndefined();

      /*
       * 第九步：直接检查 Qdrant。
       * missingVectorId 应被重新计算 Embedding 并 upsert；
       * orphanVectorId 应被删除。
       */
      const repairedVector = await retrievePoint(
        qdrant,
        collectionName,
        missingVectorId,
      );

      expect(repairedVector).toHaveLength(1);
      expect(repairedVector[0]?.id).toBe(missingVectorId);
      expect(repairedVector[0]?.payload).toMatchObject({
        memoryId: missingVectorId,
        userId,
        memoryType: "semantic",
        importance: 0.9,
        source: "consistency-integration",
      });

      expect(
        await retrievePoint(qdrant, collectionName, orphanVectorId),
      ).toEqual([]);

      /*
       * 第十步：直接检查 Neo4j。
       */
      expect(
        await countGraphRelations(
          driver,
          neo4jDatabase,
          orphanGraphId,
        ),
      ).toBe(0);
    } finally {
      /*
       * 任一断言失败也必须清理测试资源。
       * allSettled 确保一个清理失败不会阻止另一个清理。
       */
      await Promise.allSettled([
        graph.clear(userId),
        qdrant.deleteCollection(collectionName),
      ]);

      await driver.close();
      sqlite.close();
    }
  }, 60_000);
});
~~~

###### 24.4.10.5 为什么要同时检查 report 和物理后端

`repair.after` 为空只能证明扫描器认为修复完成。测试还必须绕过扫描器，直接读取后端：

| 检查对象 | 直接检查方式 | 证明内容 |
|---|---|---|
| SQLite | `documents.get(id)` | 权威文档没有被误删或篡改 |
| Qdrant | `qdrant.retrieve(collection, { ids })` | point 确实被补齐或物理删除 |
| Neo4j | `MATCH ... {memoryId}` + `count(edge)` | 关系确实被物理删除 |

不要用 `vectors.search()` 检查 point 是否存在。搜索受相似度、limit、filter 和排序影响，
“没有搜索到”不等于 point 不存在。

###### 24.4.10.6 为什么测试要按 userId 扫描

测试调用：

~~~ts
scanner.scan({ userId });
scanner.scanAndRepair({ userId });
~~~

这同时验证三个后端的租户过滤。随机 `userId` 可以隔离开发库中的其他记忆。如果测试误用
全量 `scan()`，开发环境中已有的残留数据也可能进入报告，造成不稳定失败。

Qdrant 的孤立 point payload 必须包含相同的 `userId`；Neo4j 的关系也必须包含该
`userId`。否则按用户扫描不会看到它们。

###### 24.4.10.7 运行测试

只运行这一项：

~~~bash
RUN_MEMORY_INTEGRATION_TESTS=true npx vitest run tests/memory-consistency-scanner.integration.test.ts
~~~

运行全部记忆集成测试：

~~~bash
npm run test:memory:integration
~~~

普通测试不设置开关，因此该文件应显示 skipped：

~~~bash
npm test
~~~

###### 24.4.10.8 常见错误排查

如果报告没有 `orphanVectorId`：

~~~text
检查 Qdrant payload 是否同时包含 memoryId 和测试 userId。
检查 listMemoryIds(userId) 是否真的把 userId 转成 payload filter。
~~~

如果报告没有 `orphanGraphId`：

~~~text
检查关系类型是否为 MEMORY_RELATION。
检查 edge.memoryId 和 edge.userId 是否已经写入。
检查 Neo4j listMemoryIds() 是否使用 DISTINCT edge.memoryId。
~~~

如果 `missingVectorId` 修复后仍然缺失：

~~~text
检查 createMemoryVectorRecord() 是否让 id 等于 item.id。
检查 HashEmbeddingClient 维度与 Qdrant collection 维度是否都为 64。
检查 Qdrant upsert 是否设置 wait: true。
~~~

如果 Neo4j 连接失败：

~~~text
检查容器状态、NEO4J_URI、NEO4J_USERNAME 和 NEO4J_PASSWORD。
特别注意 .env 密码必须与 docker-compose.memory.yml 一致。
~~~

如果测试结束后留下 collection 或图数据：

~~~text
确认清理代码放在 finally 中。
确认使用随机 userId 和随机 collectionName。
确认 driver.close() 和 sqlite.close() 一定执行。
~~~

###### 24.4.10.9 本小节完成标准

下面全部满足后，才算完成真实漂移演练：

~~~text
[ ] 修复前直接物理检查确认三种漂移真实存在
[ ] scan() 精确报告三个不同 ID
[ ] scan() 后数据保持不变，证明扫描是只读操作
[ ] scanAndRepair() 报告三个修复动作且 failures 为空
[ ] 独立再次 scan() 返回三个空数组
[ ] SQLite 权威文档仍然存在且内容不变
[ ] Qdrant 缺失 point 已补齐，孤立 point 已删除
[ ] Neo4j 孤立关系已删除
[ ] finally 能清理随机 collection、随机用户图数据和数据库连接
[ ] 单项集成测试以及完整集成测试均通过
~~~

至此，“扫描 + 直接修复”基础版完成。先不要实现定时器；先把扫描器做成一个可被脚本、
cron 或队列消费者显式调用的服务。

##### 24.4.11 严格审计模式：扫描器只写 outbox

###### 24.4.11.1 先明确这一版 outbox 的边界

如果要求每个一致性修复动作都可追踪，就不要让扫描进程直接修改 Qdrant/Neo4j。执行链
改为：

~~~text
扫描器 scan()
→ 把每个差异写入 SQLite memory_outbox
→ 独立 worker 领取任务
→ 执行 Embedding/upsert/delete
→ 标记 COMPLETED 或 FAILED
~~~

这是一套“维护修复 outbox”，记录扫描器发现的修复任务。它还不是在线写入的事务 outbox。
例如，`SemanticMemory.add()` 写 SQLite 后进程立即崩溃，扫描器下次运行才会发现缺失向量
并入队。如果以后要求在线写入与 outbox 事件绝对原子，需要让“写 memories 表”和“写
memory_outbox 表”处于同一个 SQLite 事务，那是下一阶段改造。

严格模式下必须遵守：

~~~text
scan()                         只读三个后端
enqueueConsistencyRepairs()   只写 SQLite outbox
MemoryOutboxWorker            才能写 Qdrant/Neo4j
scanAndRepair()                严格模式不调用
~~~

###### 24.4.11.2 设计状态机和幂等键

状态变化如下：

~~~text
PENDING → PROCESSING → COMPLETED
                 └──→ FAILED → 下一轮 worker 再次领取
                               → 达到上限后 DEAD_LETTER
~~~

同一个 `memoryId + operation` 只能存在一个未解决任务。以下状态都视为未解决：

~~~text
PENDING、PROCESSING、FAILED、DEAD_LETTER
~~~

`COMPLETED` 不阻止以后创建新任务，因为同一种数据漂移可能在未来再次发生。
`DEAD_LETTER` 会阻止自动创建新任务，必须由维护人员检查后显式重新入队。

###### 24.4.11.3 创建 SqliteMemoryOutbox

不要把 outbox 表迁移塞进 `SqliteDocumentStore`。outbox 是独立维护模块，应由自己的仓储
负责建表。创建 `src/memory/consistency/sqlite-memory-outbox.ts`，完整代码如下：

~~~ts
import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";

const operations = [
  "UPSERT_VECTOR",
  "DELETE_VECTOR",
  "DELETE_GRAPH",
] as const;

const statuses = [
  "PENDING",
  "PROCESSING",
  "COMPLETED",
  "FAILED",
  "DEAD_LETTER",
] as const;

export type MemoryOutboxOperation = (typeof operations)[number];
export type MemoryOutboxStatus = (typeof statuses)[number];

export interface MemoryOutboxTask {
  id: string;
  memoryId: string;
  operation: MemoryOutboxOperation;
  payload: Record<string, unknown>;
  status: MemoryOutboxStatus;
  attempts: number;
  createdAt: string;
  lastError?: string;
}

interface OutboxRow {
  id: string;
  memory_id: string;
  operation: string;
  payload_json: string;
  status: string;
  attempts: number;
  created_at: string;
  last_error: string | null;
}

function includesValue<T extends string>(
  values: readonly T[],
  value: string,
): value is T {
  return values.includes(value as T);
}

function rowToTask(row: OutboxRow): MemoryOutboxTask {
  if (!includesValue(operations, row.operation)) {
    throw new Error(`Outbox ${row.id} 的 operation 不合法：${row.operation}`);
  }
  if (!includesValue(statuses, row.status)) {
    throw new Error(`Outbox ${row.id} 的 status 不合法：${row.status}`);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(row.payload_json);
  } catch {
    throw new Error(`Outbox ${row.id} 的 payload_json 不是合法 JSON`);
  }

  if (
    typeof payload !== "object" ||
    payload === null ||
    Array.isArray(payload)
  ) {
    throw new Error(`Outbox ${row.id} 的 payload_json 必须是 JSON 对象`);
  }

  return {
    id: row.id,
    memoryId: row.memory_id,
    operation: row.operation,
    payload: payload as Record<string, unknown>,
    status: row.status,
    attempts: row.attempts,
    createdAt: row.created_at,
    ...(row.last_error ? { lastError: row.last_error } : {}),
  };
}

export class SqliteMemoryOutbox {
  public constructor(
    private readonly database: Database.Database,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.migrate();
  }

  private migrate(): void {
    this.database.exec(
      [
        "CREATE TABLE IF NOT EXISTS memory_outbox (",
        "  id TEXT PRIMARY KEY,",
        "  memory_id TEXT NOT NULL,",
        "  operation TEXT NOT NULL CHECK (operation IN (",
        "    'UPSERT_VECTOR', 'DELETE_VECTOR', 'DELETE_GRAPH'",
        "  )),",
        "  payload_json TEXT NOT NULL,",
        "  status TEXT NOT NULL CHECK (status IN (",
        "    'PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'DEAD_LETTER'",
        "  )),",
        "  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),",
        "  created_at TEXT NOT NULL,",
        "  last_error TEXT",
        ");",
        "CREATE INDEX IF NOT EXISTS idx_memory_outbox_status_created",
        "  ON memory_outbox(status, created_at);",
        "CREATE INDEX IF NOT EXISTS idx_memory_outbox_memory_operation",
        "  ON memory_outbox(memory_id, operation);",
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_memory_outbox_unresolved",
        "  ON memory_outbox(memory_id, operation)",
        "  WHERE status IN (",
        "    'PENDING', 'PROCESSING', 'FAILED', 'DEAD_LETTER'",
        "  );",
      ].join("\n"),
    );
  }

  /** 同一个未完成修复只保留一条任务，防止重复扫描不断堆积。 */
  public enqueue(
    memoryId: string,
    operation: MemoryOutboxOperation,
    payload: Record<string, unknown> = {},
  ): string | undefined {
    if (memoryId.trim().length === 0) {
      throw new Error("Outbox memoryId 不能为空");
    }

    const id = randomUUID();
    const result = this.database.prepare(
      [
        "INSERT INTO memory_outbox (",
        "  id, memory_id, operation, payload_json, status, created_at",
        ")",
        "SELECT @id, @memoryId, @operation, @payloadJson, 'PENDING', @createdAt",
        "WHERE NOT EXISTS (",
        "  SELECT 1 FROM memory_outbox",
        "  WHERE memory_id = @memoryId",
        "    AND operation = @operation",
        "    AND status IN (",
        "      'PENDING', 'PROCESSING', 'FAILED', 'DEAD_LETTER'",
        "    )",
        ")",
      ].join("\n"),
    ).run({
      id,
      memoryId,
      operation,
      payloadJson: JSON.stringify(payload),
      createdAt: this.now().toISOString(),
    });

    return result.changes > 0 ? id : undefined;
  }

  /**
   * 当前教程限定单 worker。事务保证读取和改成 PROCESSING 同时完成。
   */
  public claimNext(maxAttempts: number): MemoryOutboxTask | undefined {
    if (!Number.isInteger(maxAttempts) || maxAttempts <= 0) {
      throw new Error("maxAttempts 必须是正整数");
    }

    const claim = this.database.transaction(() => {
      const row = this.database.prepare(
        [
          "SELECT * FROM memory_outbox",
          "WHERE status IN ('PENDING', 'FAILED')",
          "  AND attempts < ?",
          "ORDER BY created_at ASC",
          "LIMIT 1",
        ].join("\n"),
      ).get(maxAttempts) as OutboxRow | undefined;

      if (!row) return undefined;

      this.database.prepare(
        [
          "UPDATE memory_outbox",
          "SET status = 'PROCESSING', attempts = attempts + 1, last_error = NULL",
          "WHERE id = ?",
        ].join("\n"),
      ).run(row.id);

      return rowToTask({
        ...row,
        status: "PROCESSING",
        attempts: row.attempts + 1,
        last_error: null,
      });
    });

    return claim();
  }

  public complete(id: string): void {
    const result = this.database.prepare(
      [
        "UPDATE memory_outbox",
        "SET status = 'COMPLETED', last_error = NULL",
        "WHERE id = ? AND status = 'PROCESSING'",
      ].join("\n"),
    ).run(id);

    if (result.changes !== 1) {
      throw new Error(`Outbox 任务无法完成：${id}`);
    }
  }

  public fail(id: string, message: string, deadLetter: boolean): void {
    const result = this.database.prepare(
      [
        "UPDATE memory_outbox",
        "SET status = ?, last_error = ?",
        "WHERE id = ? AND status = 'PROCESSING'",
      ].join("\n"),
    ).run(deadLetter ? "DEAD_LETTER" : "FAILED", message, id);

    if (result.changes !== 1) {
      throw new Error(`Outbox 任务无法标记失败：${id}`);
    }
  }

  /**
   * 单 worker 进程重启时恢复中断任务。
   * 已经耗尽尝试次数的任务直接进入死信，避免永远停留在 FAILED。
   */
  public recoverInterrupted(maxAttempts: number): void {
    if (!Number.isInteger(maxAttempts) || maxAttempts <= 0) {
      throw new Error("maxAttempts 必须是正整数");
    }

    this.database.prepare(
      [
        "UPDATE memory_outbox",
        "SET status = CASE",
        "      WHEN attempts >= @maxAttempts THEN 'DEAD_LETTER'",
        "      ELSE 'FAILED'",
        "    END,",
        "    last_error = 'worker interrupted'",
        "WHERE status = 'PROCESSING'",
      ].join("\n"),
    ).run({ maxAttempts });
  }

  public get(id: string): MemoryOutboxTask | undefined {
    const row = this.database.prepare(
      "SELECT * FROM memory_outbox WHERE id = ?",
    ).get(id) as OutboxRow | undefined;

    return row ? rowToTask(row) : undefined;
  }

  public list(): MemoryOutboxTask[] {
    const rows = this.database.prepare(
      "SELECT * FROM memory_outbox ORDER BY created_at ASC, id ASC",
    ).all() as OutboxRow[];

    return rows.map(rowToTask);
  }

  public countByStatus(status: MemoryOutboxStatus): number {
    const row = this.database.prepare(
      "SELECT count(*) AS count FROM memory_outbox WHERE status = ?",
    ).get(status) as { count: number };

    return row.count;
  }

  /** 人工确认外部服务恢复后，显式重新激活死信任务。 */
  public requeueDeadLetter(id: string): void {
    const result = this.database.prepare(
      [
        "UPDATE memory_outbox",
        "SET status = 'PENDING', attempts = 0, last_error = NULL",
        "WHERE id = ? AND status = 'DEAD_LETTER'",
      ].join("\n"),
    ).run(id);

    if (result.changes !== 1) {
      throw new Error(`Outbox 死信任务无法重新入队：${id}`);
    }
  }
}
~~~

###### 24.4.11.4 理解每个仓储方法

- `enqueue()`：利用一条 `INSERT ... SELECT ... WHERE NOT EXISTS` 避免重复活动任务。
- `claimNext()`：在 SQLite 事务中完成“选择 + 改为 PROCESSING + attempts 加一”。
- `complete()`：只有 PROCESSING 才允许变成 COMPLETED。
- `fail()`：保存 `last_error`，达到重试上限时进入 DEAD_LETTER。
- `recoverInterrupted(maxAttempts)`：恢复中断任务；耗尽次数时直接进入死信。
- `requeueDeadLetter()`：必须由人工确认后调用，不允许扫描器自动绕过死信。

这一版明确限制为同一个 SQLite 文件只有一个 worker。若部署多个 worker，还需要
`locked_by`、`locked_at`、租约超时和多进程安全领取语义；运行中的 worker 存在时也不能
调用 `recoverInterrupted(maxAttempts)`。

`COMPLETED` 记录是审计证据，不要在 worker 中立即删除。数据量变大后另做归档或保留期
策略，例如保留 90 天；归档任务不属于本节 worker 的职责。

生产组装时，`SqliteDocumentStore` 和 `SqliteMemoryOutbox` 必须使用同一个 SQLite 文件；
当前项目直接共享同一个 `Database` 实例最清楚：

~~~ts
const sqlite = new Database(config.MEMORY_SQLITE_PATH);
const documents = new SqliteDocumentStore(sqlite);
const outbox = new SqliteMemoryOutbox(sqlite);
~~~

不要给 outbox 使用 `:memory:`，同时让 documents 使用磁盘文件；那样 worker 重启后审计
任务会全部丢失。`:memory:` 只用于单元测试。

##### 24.4.12 把扫描结果转换成 outbox 任务

###### 24.4.12.1 建立报告与操作的固定映射

映射必须集中在一个函数里，不能散落在运行脚本中：

| 扫描结果字段 | outbox operation | worker 最终动作 |
|---|---|---|
| `missingVectorIds` | `UPSERT_VECTOR` | 读 SQLite、生成 Embedding、upsert Qdrant |
| `orphanVectorIds` | `DELETE_VECTOR` | 确认 SQLite 仍不存在后删除 Qdrant point |
| `orphanGraphMemoryIds` | `DELETE_GRAPH` | 确认 SQLite 仍不存在后删除 Neo4j 关系 |

新建 `src/memory/consistency/enqueue-consistency-repairs.ts`：

~~~ts
import type {
  MemoryOutboxOperation,
  SqliteMemoryOutbox,
} from "./sqlite-memory-outbox.js";
import type { MemoryConsistencyReport } from "./memory-consistency-types.js";

export interface EnqueueConsistencyResult {
  enqueuedTaskIds: string[];
  duplicateTaskCount: number;
}

export function enqueueConsistencyRepairs(
  report: MemoryConsistencyReport,
  outbox: SqliteMemoryOutbox,
): EnqueueConsistencyResult {
  const enqueuedTaskIds: string[] = [];
  let duplicateTaskCount = 0;

  const enqueue = (
    memoryId: string,
    operation: MemoryOutboxOperation,
  ): void => {
    const id = outbox.enqueue(memoryId, operation);
    if (id) enqueuedTaskIds.push(id);
    else duplicateTaskCount += 1;
  };

  for (const id of report.missingVectorIds) enqueue(id, "UPSERT_VECTOR");
  for (const id of report.orphanVectorIds) enqueue(id, "DELETE_VECTOR");
  for (const id of report.orphanGraphMemoryIds) enqueue(id, "DELETE_GRAPH");

  return { enqueuedTaskIds, duplicateTaskCount };
}
~~~

###### 24.4.12.2 严格模式的正确调用顺序

调用顺序只能是：

~~~ts
const report = await scanner.scan({ userId });
const queued = enqueueConsistencyRepairs(report, outbox);

console.info({ report, queued });
~~~

此处只入队，不调用 `scanner.scanAndRepair()`。入队后 Qdrant 和 Neo4j 应保持不变，直到
worker 领取任务。

`duplicateTaskCount` 不是错误。它表示上一次扫描已经为同一问题创建了未解决任务。记录
这个数字即可，不要为重复问题再次创建任务。

###### 24.4.12.3 本步骤的快速检查

使用一个临时 SQLite 数据库手动验证：

~~~ts
const report = {
  missingVectorIds: ["memory-a"],
  orphanVectorIds: ["memory-b"],
  orphanGraphMemoryIds: ["memory-c"],
};

const first = enqueueConsistencyRepairs(report, outbox);
const second = enqueueConsistencyRepairs(report, outbox);

console.log(first.enqueuedTaskIds.length); // 3
console.log(first.duplicateTaskCount);     // 0
console.log(second.enqueuedTaskIds.length); // 0
console.log(second.duplicateTaskCount);     // 3
~~~

正式自动化测试放在 24.4.14。

##### 24.4.13 实现独立 outbox worker

###### 24.4.13.1 worker 的职责边界

worker 每次只能处理一条已经进入 PROCESSING 的任务。它不负责重新扫描，也不负责生成
新的 outbox 任务：

~~~text
领取任务 → 执行一个幂等远端动作 → 更新任务状态
~~~

任务可能已经排队几分钟甚至几小时，所以删除前必须重新查询 SQLite。SQLite 中如果已经
出现同 ID 文档，说明这个 ID 不再是孤立数据，旧删除任务应按 no-op 成功完成，不能删除
刚恢复的数据。

###### 24.4.13.2 创建 worker 文件

新建 `src/memory/consistency/memory-outbox-worker.ts`：

~~~ts
import type { EmbeddingClient } from "../embedding.js";
import { createMemoryVectorRecord } from "../memory-vector-record.js";
import type { DocumentStore } from "../storage/document-store.js";
import type {
  ConsistencyGraphStore,
  ConsistencyVectorStore,
} from "./consistency-store.js";
import type { SqliteMemoryOutbox } from "./sqlite-memory-outbox.js";

export interface MemoryOutboxRunResult {
  completed: number;
  failed: number;
  deadLettered: number;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class MemoryOutboxWorker {
  public constructor(
    private readonly outbox: SqliteMemoryOutbox,
    private readonly documents: DocumentStore,
    private readonly vectors: ConsistencyVectorStore,
    private readonly graph: ConsistencyGraphStore,
    private readonly embeddings: EmbeddingClient,
    private readonly maxAttempts = 5,
  ) {
    if (!Number.isInteger(maxAttempts) || maxAttempts <= 0) {
      throw new Error("maxAttempts 必须是正整数");
    }
  }

  public async runUntilEmpty(): Promise<MemoryOutboxRunResult> {
    let completed = 0;
    let failed = 0;
    let deadLettered = 0;

    while (true) {
      const task = this.outbox.claimNext(this.maxAttempts);
      if (!task) break;

      try {
        switch (task.operation) {
          case "UPSERT_VECTOR": {
            const item = await this.documents.get(task.memoryId);

            /* 文档已被正常删除，原来的“缺向量”问题已经消失。 */
            if (item) {
              const vector = await this.embeddings.embed(item.content);
              await this.vectors.upsert([
                createMemoryVectorRecord(item, vector),
              ]);
            }
            break;
          }
          case "DELETE_VECTOR": {
            /* 任务可能排队很久；执行前重新检查权威来源。 */
            const item = await this.documents.get(task.memoryId);
            if (!item) await this.vectors.delete([task.memoryId]);
            break;
          }
          case "DELETE_GRAPH": {
            const item = await this.documents.get(task.memoryId);
            if (!item) await this.graph.deleteByMemoryId(task.memoryId);
            break;
          }
        }

        this.outbox.complete(task.id);
        completed += 1;
      } catch (error: unknown) {
        const deadLetter = task.attempts >= this.maxAttempts;
        this.outbox.fail(task.id, errorMessage(error), deadLetter);
        failed += 1;
        if (deadLetter) deadLettered += 1;

        /*
         * 本轮不立即再次领取同一 FAILED 任务，避免外部服务故障时热循环。
         * 由下一次定时运行继续重试。
         */
        break;
      }
    }

    return { completed, failed, deadLettered };
  }
}
~~~

###### 24.4.13.3 理解三个操作为什么可重试

`UPSERT_VECTOR`：

~~~text
每次都读取 SQLite 最新文档
→ 用当前 EmbeddingClient 重新计算
→ 使用固定 memoryId upsert
~~~

相同 ID 的 upsert 会覆盖同一 point，不会创建重复 point。若文档已经被删除，任务 no-op
完成，因为“SQLite 有文档但缺向量”的前提已经消失。

`DELETE_VECTOR`：

~~~text
先检查 SQLite 仍然没有文档
→ 删除 point
~~~

删除已经不存在的 point 也应成功。

`DELETE_GRAPH`：

~~~text
先检查 SQLite 仍然没有文档
→ deleteByMemoryId(memoryId)
~~~

按 `memoryId` 删除零条或多条关系都应成功。

###### 24.4.13.4 worker 启动与退出规则

进程启动时先调用一次：

~~~ts
outbox.recoverInterrupted(maxAttempts);
const result = await worker.runUntilEmpty();

if (result.failed > 0) {
  process.exitCode = 1;
}
~~~

只有确认当前没有另一个 worker 正在运行时，才能调用 `recoverInterrupted(maxAttempts)`。它会把所有
PROCESSING 任务视为上一次进程崩溃留下的任务。

`upsert` 和两个 `delete` 都必须保持幂等，因此 worker 在“远端操作已成功、但写
COMPLETED 前进程崩溃”后可以安全重试。达到 `maxAttempts` 后进入 `DEAD_LETTER`，必须
报警并人工检查，不能继续对外宣称修复成功。

由于当前表没有 `next_attempt_at`，本教程在第一次失败后结束本轮 worker，由下一次 cron
或手动执行继续重试，避免外部服务故障时发生热循环。以后需要指数退避时，再增加
`next_attempt_at` 并让 `claimNext()` 只领取到期任务。

##### 24.4.14 outbox 测试顺序

不要一开始就连接真实 Qdrant 和 Neo4j。按“仓储 → 映射 → worker → 真实集成”的顺序
测试，失败时才能快速定位层次。

###### 24.4.14.1 测试 SqliteMemoryOutbox 状态机

创建 `tests/sqlite-memory-outbox.test.ts`：

~~~ts
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { SqliteMemoryOutbox } from "../src/memory/consistency/sqlite-memory-outbox.js";

function createSubject() {
  const database = new Database(":memory:");
  const now = () => new Date("2026-08-20T10:00:00.000Z");
  const outbox = new SqliteMemoryOutbox(database, now);
  return { database, outbox };
}

describe("SqliteMemoryOutbox", () => {
  it("迁移表、去重活动任务并允许已完成任务再次创建", () => {
    const { database, outbox } = createSubject();

    try {
      const firstId = outbox.enqueue("memory-1", "DELETE_VECTOR", {
        reason: "orphan",
      });
      const duplicateId = outbox.enqueue("memory-1", "DELETE_VECTOR");

      expect(firstId).toEqual(expect.any(String));
      expect(duplicateId).toBeUndefined();
      expect(outbox.list()).toHaveLength(1);
      expect(outbox.get(firstId!)).toMatchObject({
        id: firstId,
        memoryId: "memory-1",
        operation: "DELETE_VECTOR",
        payload: { reason: "orphan" },
        status: "PENDING",
        attempts: 0,
        createdAt: "2026-08-20T10:00:00.000Z",
      });

      const claimed = outbox.claimNext(3);
      expect(claimed).toMatchObject({
        id: firstId,
        status: "PROCESSING",
        attempts: 1,
      });

      outbox.complete(firstId!);
      expect(outbox.get(firstId!)?.status).toBe("COMPLETED");

      /* COMPLETED 已解决，因此未来再次漂移时允许创建新任务。 */
      const newId = outbox.enqueue("memory-1", "DELETE_VECTOR");
      expect(newId).toEqual(expect.any(String));
      expect(newId).not.toBe(firstId);
      expect(outbox.list()).toHaveLength(2);
    } finally {
      database.close();
    }
  });

  it("失败任务可重试，达到上限后进入死信", () => {
    const { database, outbox } = createSubject();

    try {
      const id = outbox.enqueue("memory-2", "DELETE_GRAPH");
      expect(id).toEqual(expect.any(String));

      const firstAttempt = outbox.claimNext(2);
      expect(firstAttempt?.attempts).toBe(1);
      outbox.fail(firstAttempt!.id, "Neo4j unavailable", false);

      expect(outbox.get(id!)).toMatchObject({
        status: "FAILED",
        attempts: 1,
        lastError: "Neo4j unavailable",
      });

      const secondAttempt = outbox.claimNext(2);
      expect(secondAttempt?.attempts).toBe(2);
      outbox.fail(secondAttempt!.id, "Neo4j unavailable", true);

      expect(outbox.get(id!)).toMatchObject({
        status: "DEAD_LETTER",
        attempts: 2,
        lastError: "Neo4j unavailable",
      });
      expect(outbox.claimNext(2)).toBeUndefined();

      /* 死信未人工处理前，扫描器不能绕过它创建重复任务。 */
      expect(
        outbox.enqueue("memory-2", "DELETE_GRAPH"),
      ).toBeUndefined();

      outbox.requeueDeadLetter(id!);
      expect(outbox.get(id!)).toMatchObject({
        status: "PENDING",
        attempts: 0,
      });
    } finally {
      database.close();
    }
  });

  it("单 worker 重启时恢复中断任务", () => {
    const { database, outbox } = createSubject();

    try {
      const id = outbox.enqueue("memory-3", "UPSERT_VECTOR");
      expect(outbox.claimNext(3)?.status).toBe("PROCESSING");

      outbox.recoverInterrupted(3);

      expect(outbox.get(id!)).toMatchObject({
        status: "FAILED",
        attempts: 1,
        lastError: "worker interrupted",
      });
    } finally {
      database.close();
    }
  });
});
~~~

运行：

~~~bash
npx vitest run tests/sqlite-memory-outbox.test.ts
~~~

第一个测试使用 `firstId!` 是因为前面已经断言首次入队一定返回字符串。在业务实现中仍应
避免无条件使用非空断言。

###### 24.4.14.2 测试报告到任务的映射和重复入队

创建 `tests/enqueue-consistency-repairs.test.ts`：

~~~ts
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { enqueueConsistencyRepairs } from "../src/memory/consistency/enqueue-consistency-repairs.js";
import { SqliteMemoryOutbox } from "../src/memory/consistency/sqlite-memory-outbox.js";

describe("enqueueConsistencyRepairs", () => {
  it("把三类不一致映射成三类 outbox 任务并去重", () => {
    const database = new Database(":memory:");
    const outbox = new SqliteMemoryOutbox(database);
    const report = {
      missingVectorIds: ["missing-vector"],
      orphanVectorIds: ["orphan-vector"],
      orphanGraphMemoryIds: ["orphan-graph"],
    };

    try {
      const first = enqueueConsistencyRepairs(report, outbox);

      expect(first.enqueuedTaskIds).toHaveLength(3);
      expect(first.duplicateTaskCount).toBe(0);
      expect(
        outbox
          .list()
          .map((task) => `${task.operation}:${task.memoryId}`)
          .sort(),
      ).toEqual([
        "DELETE_GRAPH:orphan-graph",
        "DELETE_VECTOR:orphan-vector",
        "UPSERT_VECTOR:missing-vector",
      ]);
      expect(
        outbox.list().every((task) => task.status === "PENDING"),
      ).toBe(true);

      const second = enqueueConsistencyRepairs(report, outbox);

      expect(second.enqueuedTaskIds).toEqual([]);
      expect(second.duplicateTaskCount).toBe(3);
      expect(outbox.list()).toHaveLength(3);
    } finally {
      database.close();
    }
  });
});
~~~

运行：

~~~bash
npx vitest run tests/enqueue-consistency-repairs.test.ts
~~~

###### 24.4.14.3 测试 worker 的成功、过期任务保护和死信

创建 `tests/memory-outbox-worker.test.ts`：

~~~ts
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { HashEmbeddingClient } from "../src/memory/embedding.js";
import { MemoryOutboxWorker } from "../src/memory/consistency/memory-outbox-worker.js";
import { SqliteMemoryOutbox } from "../src/memory/consistency/sqlite-memory-outbox.js";
import { InMemoryDocumentStore } from "../src/memory/storage/document-store.js";
import type { VectorRecord } from "../src/memory/storage/vector-store.js";

class FakeWorkerVectorStore {
  public readonly records = new Map<string, VectorRecord>();
  public readonly failedDeleteIds = new Set<string>();

  public async listMemoryIds(): Promise<string[]> {
    return [...this.records.keys()].sort();
  }

  public async upsert(records: VectorRecord[]): Promise<void> {
    for (const record of records) {
      this.records.set(record.id, structuredClone(record));
    }
  }

  public async delete(ids: string[]): Promise<void> {
    for (const id of ids) {
      if (this.failedDeleteIds.has(id)) {
        throw new Error(`模拟 Qdrant 删除失败：${id}`);
      }
      this.records.delete(id);
    }
  }
}

class FakeWorkerGraphStore {
  public readonly memoryIds = new Set<string>();

  public async listMemoryIds(): Promise<string[]> {
    return [...this.memoryIds].sort();
  }

  public async deleteByMemoryId(memoryId: string): Promise<void> {
    this.memoryIds.delete(memoryId);
  }
}

function createSubject(maxAttempts = 3) {
  const database = new Database(":memory:");
  const outbox = new SqliteMemoryOutbox(database);
  const documents = new InMemoryDocumentStore();
  const vectors = new FakeWorkerVectorStore();
  const graph = new FakeWorkerGraphStore();
  const worker = new MemoryOutboxWorker(
    outbox,
    documents,
    vectors,
    graph,
    new HashEmbeddingClient(8),
    maxAttempts,
  );

  return {
    database,
    outbox,
    documents,
    vectors,
    graph,
    worker,
  };
}

describe("MemoryOutboxWorker", () => {
  it("完成补向量、删孤立向量和删孤立图关系", async () => {
    const subject = createSubject();

    try {
      await subject.documents.add({
        id: "missing-vector",
        content: "用户喜欢 TypeScript",
        memoryType: "semantic",
        userId: "user-1",
        timestamp: "2026-08-20T10:00:00.000Z",
        importance: 0.9,
        metadata: { source: "worker-test" },
      });
      await subject.vectors.upsert([
        {
          id: "orphan-vector",
          vector: new Array(8).fill(0),
          metadata: { memoryId: "orphan-vector" },
        },
      ]);
      subject.graph.memoryIds.add("orphan-graph");

      subject.outbox.enqueue("missing-vector", "UPSERT_VECTOR");
      subject.outbox.enqueue("orphan-vector", "DELETE_VECTOR");
      subject.outbox.enqueue("orphan-graph", "DELETE_GRAPH");

      await expect(subject.worker.runUntilEmpty()).resolves.toEqual({
        completed: 3,
        failed: 0,
        deadLettered: 0,
      });

      expect(subject.vectors.records.has("missing-vector")).toBe(true);
      expect(subject.vectors.records.has("orphan-vector")).toBe(false);
      expect(subject.graph.memoryIds.has("orphan-graph")).toBe(false);
      expect(
        subject.outbox.list().every(
          (task) => task.status === "COMPLETED" && task.attempts === 1,
        ),
      ).toBe(true);
    } finally {
      subject.database.close();
    }
  });

  it("删除任务过期时保留 SQLite 已恢复的数据", async () => {
    const subject = createSubject();

    try {
      await subject.documents.add({
        id: "restored-memory",
        content: "这条记忆已经恢复",
        memoryType: "semantic",
        userId: "user-1",
        timestamp: "2026-08-20T10:00:00.000Z",
        importance: 0.8,
        metadata: {},
      });
      await subject.vectors.upsert([
        {
          id: "restored-memory",
          vector: new Array(8).fill(0),
          metadata: { memoryId: "restored-memory" },
        },
      ]);
      subject.graph.memoryIds.add("restored-memory");

      subject.outbox.enqueue("restored-memory", "DELETE_VECTOR");
      subject.outbox.enqueue("restored-memory", "DELETE_GRAPH");

      await subject.worker.runUntilEmpty();

      expect(subject.vectors.records.has("restored-memory")).toBe(true);
      expect(subject.graph.memoryIds.has("restored-memory")).toBe(true);
      expect(
        subject.outbox.list().every((task) => task.status === "COMPLETED"),
      ).toBe(true);
    } finally {
      subject.database.close();
    }
  });

  it("保存失败原因并在达到上限后进入死信", async () => {
    const subject = createSubject(2);

    try {
      await subject.vectors.upsert([
        {
          id: "cannot-delete",
          vector: new Array(8).fill(0),
          metadata: { memoryId: "cannot-delete" },
        },
      ]);
      subject.vectors.failedDeleteIds.add("cannot-delete");
      const taskId = subject.outbox.enqueue(
        "cannot-delete",
        "DELETE_VECTOR",
      );

      await expect(subject.worker.runUntilEmpty()).resolves.toEqual({
        completed: 0,
        failed: 1,
        deadLettered: 0,
      });
      expect(subject.outbox.get(taskId!)).toMatchObject({
        status: "FAILED",
        attempts: 1,
        lastError: "模拟 Qdrant 删除失败：cannot-delete",
      });

      await expect(subject.worker.runUntilEmpty()).resolves.toEqual({
        completed: 0,
        failed: 1,
        deadLettered: 1,
      });
      expect(subject.outbox.get(taskId!)).toMatchObject({
        status: "DEAD_LETTER",
        attempts: 2,
      });

      /* 死信不会被第三轮自动领取。 */
      await expect(subject.worker.runUntilEmpty()).resolves.toEqual({
        completed: 0,
        failed: 0,
        deadLettered: 0,
      });
    } finally {
      subject.database.close();
    }
  });
});
~~~

运行：

~~~bash
npx vitest run tests/memory-outbox-worker.test.ts
~~~

“过期任务保护”测试不可省略。outbox 将扫描和修复分成两个时间点，如果 worker 不重新检查
SQLite，就可能执行一个已经失效的删除决定。

###### 24.4.14.4 运行全部 outbox 单元测试

~~~bash
npx vitest run \
  tests/sqlite-memory-outbox.test.ts \
  tests/enqueue-consistency-repairs.test.ts \
  tests/memory-outbox-worker.test.ts
npm run typecheck
~~~

Windows PowerShell 可以分开运行三个文件，或者直接使用 `npm test`。

###### 24.4.14.5 做真实 outbox 端到端演练

复制 24.4.10 的测试文件，命名为：

~~~text
tests/memory-consistency-outbox.integration.test.ts
~~~

保留其中所有真实连接、随机 ID、三种漂移注入、物理检查和 `finally` 清理代码。然后完成
以下修改。

第一处，增加导入：

~~~ts
import { enqueueConsistencyRepairs } from "../src/memory/consistency/enqueue-consistency-repairs.js";
import { MemoryOutboxWorker } from "../src/memory/consistency/memory-outbox-worker.js";
import { SqliteMemoryOutbox } from "../src/memory/consistency/sqlite-memory-outbox.js";
~~~

第二处，在创建 `scanner` 后创建 outbox 和 worker：

~~~ts
const outbox = new SqliteMemoryOutbox(sqlite);
const worker = new MemoryOutboxWorker(
  outbox,
  documents,
  vectors,
  graph,
  embeddings,
  3,
);
~~~

第三处，保留三种漂移注入和 `reportBefore` 断言，删除原测试中直接调用
`scanner.scanAndRepair()` 的部分，替换为：

~~~ts
/* 第一步：扫描结果只进入 outbox。 */
const queued = enqueueConsistencyRepairs(reportBefore, outbox);

expect(queued.enqueuedTaskIds).toHaveLength(3);
expect(queued.duplicateTaskCount).toBe(0);
expect(
  outbox.list().map((task) => task.status),
).toEqual(["PENDING", "PENDING", "PENDING"]);

/* 第二步：重复入队不会产生另外三行。 */
const duplicate = enqueueConsistencyRepairs(reportBefore, outbox);
expect(duplicate.enqueuedTaskIds).toEqual([]);
expect(duplicate.duplicateTaskCount).toBe(3);
expect(outbox.list()).toHaveLength(3);

/*
 * 第三步：入队阶段不能修改外部后端。
 * 缺失向量仍然缺失、孤立向量和孤立图关系仍然存在。
 */
expect(
  await retrievePoint(qdrant, collectionName, missingVectorId),
).toEqual([]);
expect(
  await retrievePoint(qdrant, collectionName, orphanVectorId),
).toHaveLength(1);
expect(
  await countGraphRelations(driver, neo4jDatabase, orphanGraphId),
).toBe(1);

/* 第四步：只有 worker 执行实际修复。 */
const workerResult = await worker.runUntilEmpty();

expect(workerResult).toEqual({
  completed: 3,
  failed: 0,
  deadLettered: 0,
});
expect(
  outbox.list().every(
    (task) => task.status === "COMPLETED" && task.attempts === 1,
  ),
).toBe(true);

/* 第五步：重新扫描应无不一致。 */
await expect(scanner.scan({ userId })).resolves.toEqual({
  missingVectorIds: [],
  orphanVectorIds: [],
  orphanGraphMemoryIds: [],
});

/* 第六步：直接检查三个后端，不只相信扫描报告。 */
expect(await documents.get(missingVectorId)).toBeDefined();

const repairedVector = await retrievePoint(
  qdrant,
  collectionName,
  missingVectorId,
);
expect(repairedVector).toHaveLength(1);
expect(repairedVector[0]?.payload).toMatchObject({
  memoryId: missingVectorId,
  userId,
  memoryType: "semantic",
});

expect(
  await retrievePoint(qdrant, collectionName, orphanVectorId),
).toEqual([]);
expect(
  await countGraphRelations(driver, neo4jDatabase, orphanGraphId),
).toBe(0);
~~~

注意：`outbox.list()` 按 `created_at, id` 排序，三个任务的 operation 顺序不应作为集成测试
断言；这里只检查状态全部为 PENDING/COMPLETED。

运行：

~~~bash
RUN_MEMORY_INTEGRATION_TESTS=true npx vitest run tests/memory-consistency-outbox.integration.test.ts
~~~

再运行全部集成测试：

~~~bash
npm run test:memory:integration
~~~

###### 24.4.14.6 添加导出

所有测试通过后，在 `src/memory/index.ts` 增加：

~~~ts
export {
  enqueueConsistencyRepairs,
} from "./consistency/enqueue-consistency-repairs.js";
export type {
  EnqueueConsistencyResult,
} from "./consistency/enqueue-consistency-repairs.js";
export {
  MemoryOutboxWorker,
} from "./consistency/memory-outbox-worker.js";
export type {
  MemoryOutboxRunResult,
} from "./consistency/memory-outbox-worker.js";
export {
  SqliteMemoryOutbox,
} from "./consistency/sqlite-memory-outbox.js";
export type {
  MemoryOutboxOperation,
  MemoryOutboxStatus,
  MemoryOutboxTask,
} from "./consistency/sqlite-memory-outbox.js";
~~~

###### 24.4.14.7 最终验收顺序

按下面顺序运行，不要只运行最后一条：

~~~bash
npm run typecheck
npx vitest run tests/sqlite-memory-outbox.test.ts
npx vitest run tests/enqueue-consistency-repairs.test.ts
npx vitest run tests/memory-outbox-worker.test.ts
npm test
docker compose -f docker-compose.memory.yml up -d
RUN_MEMORY_INTEGRATION_TESTS=true npx vitest run tests/memory-consistency-outbox.integration.test.ts
npm run test:memory:integration
~~~

本阶段完成标准：

~~~text
[ ] outbox 自己负责迁移 memory_outbox 表
[ ] 重复扫描不会创建重复未解决任务
[ ] scan + enqueue 阶段不会修改 Qdrant/Neo4j
[ ] worker 成功后任务为 COMPLETED
[ ] worker 失败后保存 attempts 和 last_error
[ ] 达到重试上限后进入 DEAD_LETTER
[ ] 过期删除任务不会删除 SQLite 已恢复的数据
[ ] 真实 worker 修复后三个物理后端符合 SQLite 权威状态
[ ] worker 失败时进程退出码非 0，不会报告成功
~~~

##### 24.4.15 组装并提供手动执行入口

严格 Outbox 模式复用生产工厂创建的 SQLite、Qdrant、Neo4j 和 Embedding 依赖，不在命令
脚本中复制连接代码。

`ProductionMemoryRuntime` 应同时返回：

~~~ts
export interface ProductionMemoryRuntime {
  manager: MemoryManager;
  consistencyScanner: MemoryConsistencyScanner;
  consistencyOutbox: SqliteMemoryOutbox;
  outboxWorker: MemoryOutboxWorker;
  close(): Promise<void>;
}
~~~

`SqliteDocumentStore` 和 `SqliteMemoryOutbox` 必须共享同一个 SQLite 实例：

~~~ts
const documents = new SqliteDocumentStore(sqlite);
const consistencyOutbox = new SqliteMemoryOutbox(sqlite, now);
~~~

创建 scanner 后，再创建 worker：

~~~ts
const outboxWorker = new MemoryOutboxWorker(
  consistencyOutbox,
  documents,
  vectors,
  graph,
  embeddings,
  options.infrastructure.MEMORY_OUTBOX_MAX_ATTEMPTS,
);
~~~

提供三个职责单一的入口：

~~~text
src/examples/memory-consistency.ts          只读扫描
src/examples/memory-consistency-enqueue.ts  扫描并写入 outbox
src/examples/memory-outbox-worker.ts        执行 outbox 任务
~~~

严格模式不再使用 `MEMORY_CONSISTENCY_REPAIR`，也不从命令入口调用
`scanAndRepair()`。入队入口执行：

~~~ts
const report = await runtime.consistencyScanner.scan(options);
const queued = enqueueConsistencyRepairs(
  report,
  runtime.consistencyOutbox,
);
~~~

worker 入口先恢复中断任务，再执行队列：

~~~ts
runtime.consistencyOutbox.recoverInterrupted(
  infrastructure.MEMORY_OUTBOX_MAX_ATTEMPTS,
);
const result = await runtime.outboxWorker.runUntilEmpty();
const deadLetterCount =
  runtime.consistencyOutbox.countByStatus("DEAD_LETTER");

if (result.failed > 0 || deadLetterCount > 0) {
  process.exitCode = 1;
}
~~~

在 `package.json` 中增加：

~~~json
"memory:consistency": "npm run memory:consistency:scan",
"memory:consistency:scan": "tsx src/examples/memory-consistency.ts",
"memory:consistency:enqueue": "tsx src/examples/memory-consistency-enqueue.ts",
"memory:outbox:work": "tsx src/examples/memory-outbox-worker.ts"
~~~

手动执行顺序：

~~~bash
# 第一步：只读扫描并人工检查报告
MEMORY_SCAN_USER_ID=user-123 npm run memory:consistency:scan

# 第二步：再次扫描并把修复动作写入 outbox
MEMORY_SCAN_USER_ID=user-123 npm run memory:consistency:enqueue

# 第三步：独立 worker 执行任务
npm run memory:outbox:work

# 第四步：重新扫描，三个数组应为空
MEMORY_SCAN_USER_ID=user-123 npm run memory:consistency:scan
~~~

生产环境推荐按 `userId` 分批运行。全量扫描会把三个 ID 集合保存在 Node.js 内存中，
数据量较大时应进一步改成游标分片和批量对账。

##### 24.4.16 最终运行方式和验收标准

推荐把扫描、入队和 worker 作为三个独立命令，而不是挂在每次 Agent 请求上：

~~~text
memory:consistency:scan      只读扫描并输出报告
memory:consistency:enqueue   扫描并把修复动作写入 outbox
memory:outbox:work           执行已记录的修复任务
~~~

基础版完成标准：

~~~text
[ ] Qdrant scroll 能跨两页返回全部 memoryId
[ ] Neo4j 对多条关系只返回一个 DISTINCT memoryId
[ ] scan() 本身绝不写三个后端
[ ] 缺失向量使用当前 EmbeddingClient 和统一 payload 重建
[ ] 两类孤立数据能够幂等删除
[ ] 任一修复失败都会抛错，并带有 failures/after 报告
[ ] 单元测试通过
[ ] 真实 SQLite + Qdrant + Neo4j 漂移演练通过
~~~

严格 outbox 版额外完成标准：

~~~text
[ ] 扫描阶段只写 SQLite outbox，不直接修复
[ ] 重复扫描不会产生重复活动任务
[ ] 每次尝试次数和最后错误可审计
[ ] worker 中断后任务可恢复
[ ] 达到重试上限进入 DEAD_LETTER 并报警
[ ] worker 完成后重新 scan() 无残留不一致
~~~

outbox 属于可靠性增强，不要在四个适配器和基础扫描器尚未分别通过测试前提前实现。

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
