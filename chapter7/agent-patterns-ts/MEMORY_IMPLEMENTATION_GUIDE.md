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
    .match(/[\p{Script=Han}]|[\p{L}\p{N}_]+/gu) ?? [];
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
  return text.toLowerCase().match(/[\p{Script=Han}]|[\p{L}\p{N}_]+/gu) ?? [];
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

## 十八、第二阶段升级顺序

第一阶段全部通过后再安装：

```bash
npm install better-sqlite3 @qdrant/js-client-rest neo4j-driver
npm install -D @types/better-sqlite3
```

按以下顺序替换适配器：

1. `SqliteDocumentStore`：建立 `memories` 表，为 `(user_id, memory_type)` 和 `timestamp` 建索引。
2. `OpenAiEmbeddingClient`：单独实现 `EmbeddingClient`，不要塞进现有 `LlmClient`。
3. `QdrantVectorStore`：payload 必须包含 `userId`、`memoryType`、`memoryId`；每次查询都加用户过滤器。
4. `Neo4jGraphStore`：实体和关系都写入 `userId`；查询路径必须限定用户。
5. 一致性测试：模拟向量写入失败，确保文档写入回滚或进入待索引状态。
6. 删除测试：确认 SQLite、Qdrant、Neo4j 三处都不存在目标记忆。

真实后端只替换接口实现，`MemoryManager`、`MemoryTool` 和 Agent 集成不应发生结构性变化。这正是采用端口与适配器设计的目的。
