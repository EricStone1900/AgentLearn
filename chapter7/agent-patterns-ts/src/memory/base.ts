import type { MemoryItem, MemorySearchResult, MemoryType } from "./schemas.js";

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
