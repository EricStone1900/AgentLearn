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

  it("分页枚举全部 memoryId 并按 userId 隔离", async () => {
    const dimension = 4;
    const collectionName = `test_scroll_${randomUUID().replaceAll("-", "_")}`;
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
    const expectedIds = Array.from({ length: 257 }, () => randomUUID());
    const otherUserId = randomUUID();

    try {
      await store.upsert([
        ...expectedIds.map((id) => ({
          id,
          vector: [1, 0, 0, 0],
          metadata: {
            memoryId: id,
            userId: "pagination-user",
            memoryType: "semantic",
          },
        })),
        {
          id: otherUserId,
          vector: [1, 0, 0, 0],
          metadata: {
            memoryId: otherUserId,
            userId: "other-user",
            memoryType: "semantic",
          },
        },
      ]);

      await expect(
        store.listMemoryIds("pagination-user"),
      ).resolves.toEqual([...expectedIds].sort());
      await expect(store.listMemoryIds("other-user")).resolves.toEqual([
        otherUserId,
      ]);
      await expect(store.listMemoryIds()).resolves.toEqual(
        [...expectedIds, otherUserId].sort(),
      );
    } finally {
      await client.deleteCollection(collectionName);
    }
  }, 60_000);
});
