import { randomUUID } from "node:crypto";
import { QdrantClient } from "@qdrant/js-client-rest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { QdrantRagVectorStore } from "../src/rag/storage/qdrant-rag-vector-store.js";

const enabled = process.env.RUN_RAG_INTEGRATION_TESTS === "true";
const suite = enabled ? describe : describe.skip;

suite("QdrantRagVectorStore integration", () => {
  const client = new QdrantClient({ url: process.env.QDRANT_URL ?? "http://localhost:6333" });
  const collectionName = `rag_test_${randomUUID().replaceAll("-", "")}`;
  const store = new QdrantRagVectorStore({ client, collectionName, dimension: 4 });

  beforeAll(async () => {
    await store.initialize();
  });

  afterAll(async () => {
    await client.deleteCollection(collectionName);
  });

  it("按 namespace 隔离检索并按 documentId 删除", async () => {
    const firstId = randomUUID();
    const secondId = randomUUID();
    await store.upsert([
      { id: firstId, vector: [1, 0, 0, 0], namespace: "a", documentId: "doc-a", source: "a.md", chunkIndex: 0 },
      { id: secondId, vector: [1, 0, 0, 0], namespace: "b", documentId: "doc-b", source: "b.md", chunkIndex: 0 },
    ]);

    const hits = await store.search([1, 0, 0, 0], { namespace: "a", limit: 10 });
    expect(hits.map((hit) => hit.chunkId)).toEqual([firstId]);

    await store.deleteByDocumentId("doc-a");
    await expect(store.search([1, 0, 0, 0], { namespace: "a", limit: 10 }))
      .resolves.toEqual([]);
  });
});