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