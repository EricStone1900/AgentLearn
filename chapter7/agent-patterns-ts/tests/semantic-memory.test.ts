import { describe, expect, it } from "vitest";

import { HashEmbeddingClient } from "../src/memory/embedding.js";
import { RuleBasedKnowledgeExtractor } from "../src/memory/knowledge-extractor.js";
import type { MemoryItem } from "../src/memory/schemas.js";
import { InMemoryDocumentStore } from "../src/memory/storage/document-store.js";
import { InMemoryGraphStore } from "../src/memory/storage/graph-store.js";
import { InMemoryVectorStore } from "../src/memory/storage/vector-store.js";
import { SemanticMemory } from "../src/memory/types/semantic-memory.js";

interface SemanticItemOptions {
  id: string;
  content: string;
  userId?: string;
  importance?: number;
}

function createSemanticItem(options: SemanticItemOptions): MemoryItem {
  return {
    id: options.id,
    content: options.content,
    memoryType: "semantic",
    userId: options.userId ?? "user-1",
    timestamp: "2026-08-18T10:00:00.000Z",
    importance: options.importance ?? 0.8,
    metadata: {
      knowledgeType: "factual",
    },
  };
}

function createSubject() {
  const documents = new InMemoryDocumentStore();
  const vectors = new InMemoryVectorStore();
  const graph = new InMemoryGraphStore();
  const embeddings = new HashEmbeddingClient(64);
  const extractor = new RuleBasedKnowledgeExtractor();

  const memory = new SemanticMemory(
    documents,
    vectors,
    embeddings,
    graph,
    extractor,
  );

  return {
    memory,
    documents,
    vectors,
    graph,
    embeddings,
    extractor,
  };
}

describe("SemanticMemory", () => {
  it("添加语义记忆时写入文档、向量和实体关系", async () => {
    const { memory, documents, vectors, graph, embeddings, extractor } =
      createSubject();

    const item = createSemanticItem({
      id: "semantic-1",
      content: "TypeScript属于JavaScript",
    });

    await memory.add(item);

    const storedDocument = await documents.get(item.id);

    expect(storedDocument).toBeDefined();
    expect(storedDocument?.memoryType).toBe("semantic");
    expect(storedDocument?.metadata.entityIds).toEqual(expect.any(Array));

    const entityIds = storedDocument?.metadata.entityIds;

    expect(Array.isArray(entityIds)).toBe(true);
    expect((entityIds as unknown[]).length).toBeGreaterThan(0);

    const queryVector = await embeddings.embed(item.content);

    const vectorHits = await vectors.search(queryVector, 5, {
      userId: "user-1",
      memoryType: "semantic",
    });

    expect(vectorHits).toHaveLength(1);
    expect(vectorHits[0]?.id).toBe(item.id);

    const queryKnowledge = await extractor.extract("TypeScript", {
      memoryId: "query",
      userId: "user-1",
    });

    const graphHits = await graph.findRelatedMemories(
      queryKnowledge.entities,
      "user-1",
      2,
    );

    expect(graphHits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          memoryId: "semantic-1",
        }),
      ]),
    );
  });

  it("检索时融合向量分数和图分数", async () => {
    const { memory } = createSubject();

    await memory.add(
      createSemanticItem({
        id: "semantic-1",
        content: "TypeScript属于JavaScript",
      }),
    );

    const results = await memory.retrieve("TypeScript", {
      userId: "user-1",
      limit: 5,
      minImportance: 0,
    });

    expect(results).toHaveLength(1);

    const result = results[0];

    expect(result?.item.id).toBe("semantic-1");
    expect(result?.signals.vector).toBeGreaterThan(0);
    expect(result?.signals.graph).toBeGreaterThan(0);

    const expectedRelevance =
      (result?.signals.vector ?? 0) * 0.7 + (result?.signals.graph ?? 0) * 0.3;

    expect(result?.signals.relevance).toBeCloseTo(expectedRelevance);
    expect(result?.score).toBeGreaterThan(0);
  });

  it("相同记忆被向量和图同时命中时只返回一次", async () => {
    const { memory } = createSubject();

    await memory.add(
      createSemanticItem({
        id: "semantic-1",
        content: "TypeScript属于JavaScript",
      }),
    );

    const results = await memory.retrieve("TypeScript", {
      userId: "user-1",
      limit: 10,
      minImportance: 0,
    });

    expect(results).toHaveLength(1);
    expect(results[0]?.item.id).toBe("semantic-1");
  });

  it("图检索和向量检索都会进行用户隔离", async () => {
    const { memory } = createSubject();

    await memory.add(
      createSemanticItem({
        id: "user-1-memory",
        content: "TypeScript属于JavaScript",
        userId: "user-1",
      }),
    );

    await memory.add(
      createSemanticItem({
        id: "user-2-memory",
        content: "TypeScript属于JavaScript",
        userId: "user-2",
      }),
    );

    const userOneResults = await memory.retrieve("TypeScript", {
      userId: "user-1",
      limit: 10,
      minImportance: 0,
    });

    expect(userOneResults.map((result) => result.item.id)).toEqual([
      "user-1-memory",
    ]);

    const userTwoResults = await memory.retrieve("TypeScript", {
      userId: "user-2",
      limit: 10,
      minImportance: 0,
    });

    expect(userTwoResults.map((result) => result.item.id)).toEqual([
      "user-2-memory",
    ]);
  });

  it("删除语义记忆时同时清理文档、向量和图关系", async () => {
    const { memory, documents, vectors, graph, embeddings, extractor } =
      createSubject();

    const item = createSemanticItem({
      id: "semantic-1",
      content: "TypeScript属于JavaScript",
    });

    await memory.add(item);

    const removed = await memory.remove(item.id);

    expect(removed).toBe(true);
    expect(await documents.get(item.id)).toBeUndefined();

    const queryVector = await embeddings.embed(item.content);

    const vectorHits = await vectors.search(queryVector, 5, {
      userId: "user-1",
      memoryType: "semantic",
    });

    expect(vectorHits).toEqual([]);

    const queryKnowledge = await extractor.extract("TypeScript", {
      memoryId: "query",
      userId: "user-1",
    });

    const graphHits = await graph.findRelatedMemories(
      queryKnowledge.entities,
      "user-1",
      2,
    );

    expect(graphHits).toEqual([]);
  });

  it("clear(userId) 只清理指定用户的语义记忆", async () => {
    const { memory } = createSubject();

    await memory.add(
      createSemanticItem({
        id: "user-1-memory",
        content: "TypeScript属于JavaScript",
        userId: "user-1",
      }),
    );

    await memory.add(
      createSemanticItem({
        id: "user-2-memory",
        content: "Python属于编程语言",
        userId: "user-2",
      }),
    );

    await memory.clear("user-1");

    expect(await memory.has("user-1-memory")).toBe(false);
    expect(await memory.has("user-2-memory")).toBe(true);
  });

  it("语义检索必须指定 userId", async () => {
    const { memory } = createSubject();

    await expect(memory.retrieve("TypeScript")).rejects.toThrow(
      "语义图检索必须指定 userId",
    );
  });

  it("拒绝把其他类型的记忆添加到语义记忆", async () => {
    const { memory } = createSubject();

    const invalidItem: MemoryItem = {
      ...createSemanticItem({
        id: "invalid",
        content: "临时上下文",
      }),
      memoryType: "working",
    };

    await expect(memory.add(invalidItem)).rejects.toThrow(
      "SemanticMemory 不能保存 working 记忆",
    );
  });
});
