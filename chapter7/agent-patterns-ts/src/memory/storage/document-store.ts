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
      .filter(
        (item) => !filter.memoryType || item.memoryType === filter.memoryType,
      )
      .filter(
        (item) =>
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
