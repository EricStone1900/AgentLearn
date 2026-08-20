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
