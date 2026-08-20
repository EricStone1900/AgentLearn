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
        subject.outbox
          .list()
          .every((task) => task.status === "COMPLETED" && task.attempts === 1),
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
      const taskId = subject.outbox.enqueue("cannot-delete", "DELETE_VECTOR");

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
