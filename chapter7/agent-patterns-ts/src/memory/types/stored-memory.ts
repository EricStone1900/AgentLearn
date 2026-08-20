import {
  BaseMemory,
  type MemorySearchOptions,
  type MemoryStats,
  type UpdateMemoryInput,
} from "../base.js";
import type { EmbeddingClient } from "../embedding.js";
import { createMemoryVectorRecord } from "../memory-vector-record.js";
import { memoryItemSchema } from "../schemas.js";
import type { MemoryItem, MemoryType } from "../schemas.js";
import type { DocumentStore } from "../storage/document-store.js";
import type { VectorHit, VectorStore } from "../storage/vector-store.js";

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
      await this.vectors.upsert([createMemoryVectorRecord(parsed, vector)]);
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
        createMemoryVectorRecord(updated, vector),
      ]);
    } catch (error: unknown) {
      // 恢复文档和旧向量。
      await this.documents.update(current);
      const oldVector = await this.embeddings.embed(current.content);
      await this.vectors.upsert([
        createMemoryVectorRecord(current, oldVector),
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
