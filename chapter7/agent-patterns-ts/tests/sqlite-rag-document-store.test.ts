import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { RagChunk, RagDocument } from "../src/rag/schemas.js";
import { SqliteRagDocumentStore } from "../src/rag/storage/sqlite-rag-document-store.js";

function createDocument(namespace = "docs"): RagDocument {
  return {
    id: `doc-${namespace}`,
    namespace,
    source: `${namespace}.md`,
    title: namespace,
    markdown: "# 标题\n\n正文",
    contentHash: "document-hash",
    metadata: { category: "guide" },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function createChunk(
  document: RagDocument,
  id: string,
  chunkIndex: number,
): RagChunk {
  return {
    id,
    documentId: document.id,
    namespace: document.namespace,
    chunkIndex,
    content: `片段 ${chunkIndex}`,
    embeddingText: `标题 片段 ${chunkIndex}`,
    headingPath: "标题",
    startOffset: chunkIndex * 10,
    endOffset: chunkIndex * 10 + 5,
    tokenCount: 3,
    contentHash: `hash-${chunkIndex}`,
    metadata: { page: chunkIndex + 1 },
  };
}

describe("SqliteRagDocumentStore", () => {
  let database: Database.Database;
  let store: SqliteRagDocumentStore;

  beforeEach(async () => {
    database = new Database(":memory:");
    store = new SqliteRagDocumentStore(database);
    await store.initialize();
  });

  afterEach(() => {
    database.close();
  });

  it("完整保存并读取 document 和 chunks", async () => {
    const document = createDocument();
    const chunks = [
      createChunk(document, "chunk-1", 0),
      createChunk(document, "chunk-2", 1),
    ];
    await store.replaceDocument(document, chunks);

    await expect(store.getDocument(document.id)).resolves.toEqual(document);
    await expect(store.getChunksByDocument(document.id)).resolves.toEqual(chunks);
  });

  it("再次 replace 会原子替换旧 chunks", async () => {
    const document = createDocument();
    await store.replaceDocument(document, [createChunk(document, "old", 0)]);
    const updated = {
      ...document,
      markdown: "新正文",
      contentHash: "new-hash",
      updatedAt: "2026-01-02T00:00:00.000Z",
    };
    await store.replaceDocument(updated, [createChunk(updated, "new", 0)]);

    expect((await store.getChunksByDocument(document.id)).map((item) => item.id))
      .toEqual(["new"]);
    expect((await store.getDocument(document.id))?.contentHash).toBe("new-hash");
  });

  it("getChunksByIds 保持调用方顺序", async () => {
    const document = createDocument();
    await store.replaceDocument(document, [
      createChunk(document, "first", 0),
      createChunk(document, "second", 1),
    ]);
    expect((await store.getChunksByIds(["second", "first"])).map((item) => item.id))
      .toEqual(["second", "first"]);
  });

  it("删除文档会级联删除 chunks", async () => {
    const document = createDocument();
    await store.replaceDocument(document, [createChunk(document, "chunk", 0)]);
    await expect(store.deleteDocument(document.id)).resolves.toBe(true);
    await expect(store.getChunksByDocument(document.id)).resolves.toEqual([]);
  });

  it("按 namespace 统计", async () => {
    const first = createDocument("first");
    const second = createDocument("second");
    await store.replaceDocument(first, [createChunk(first, "a", 0)]);
    await store.replaceDocument(second, [
      createChunk(second, "b", 0),
      createChunk(second, "c", 1),
    ]);
    await expect(store.getStats("first")).resolves.toEqual({ documents: 1, chunks: 1 });
    await expect(store.getStats("second")).resolves.toEqual({ documents: 1, chunks: 2 });
  });

  it("拒绝损坏的 metadata_json", async () => {
    const document = createDocument();
    await store.replaceDocument(document, []);
    database.prepare("UPDATE rag_documents SET metadata_json = ? WHERE id = ?")
      .run("not-json", document.id);
    await expect(store.getDocument(document.id)).rejects.toThrow();
  });
});