import { describe, expect, it } from "vitest";
import { HashEmbeddingClient } from "../src/memory/embedding.js";
import { RagRetriever } from "../src/rag/retriever.js";
import type { RagDocumentStore } from "../src/rag/storage/rag-document-store.js";
import type { RagVectorStore } from "../src/rag/storage/rag-vector-store.js";
import type { RagChunk, RagDocument } from "../src/rag/schemas.js";

const document: RagDocument = {
  id: "doc-1", namespace: "docs", source: "guide.md", title: "guide",
  markdown: "RAG 使用向量检索", contentHash: "h", metadata: {},
  indexFingerprint: "index-v1",
  createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
};
const chunk: RagChunk = {
  id: "chunk-1", documentId: "doc-1", namespace: "docs", chunkIndex: 0,
  content: "RAG 使用向量检索", embeddingText: "RAG 使用向量检索",
  startOffset: 0, endOffset: 10, tokenCount: 8, contentHash: "h", metadata: {},
};

const documents: RagDocumentStore = {
  async initialize() {},
  async getDocument(namespace, id) {
    return namespace === document.namespace && id === document.id
      ? document
      : undefined;
  },
  async getChunksByDocument() { return [chunk]; },
  async getChunksByIds(namespace, ids) {
    return namespace === chunk.namespace && ids.includes(chunk.id) ? [chunk] : [];
  },
  async replaceDocument() {},
  async deleteDocument() { return true; },
  async getStats() { return { documents: 1, chunks: 1 }; },
};

describe("RagRetriever", () => {
  it("按 namespace 搜索并从 SQLite 回填内容", async () => {
    let receivedNamespace = "";
    const vectors: RagVectorStore = {
      async initialize() {},
      async upsert() {},
      async search(_vector, options) {
        receivedNamespace = options.namespace;
        return [{ chunkId: "chunk-1", score: 0.91 }];
      },
      async deleteChunkIds() {},
      async deleteByDocumentId() {},
    };
    const retriever = new RagRetriever(
      documents, vectors, new HashEmbeddingClient(16),
    );
    const results = await retriever.search("如何检索", {
      namespace: "docs", limit: 3,
    });
    expect(receivedNamespace).toBe("docs");
    expect(results).toHaveLength(1);
    expect(results[0]?.chunk.content).toContain("向量检索");
    expect(results[0]?.score).toBe(0.91);
  });

  it("丢弃 Qdrant 中找不到 SQLite chunk 的孤立命中", async () => {
    const vectors: RagVectorStore = {
      async initialize() {}, async upsert() {}, async deleteChunkIds() {},
      async deleteByDocumentId() {},
      async search() { return [{ chunkId: "orphan", score: 0.99 }]; },
    };
    const retriever = new RagRetriever(documents, vectors, new HashEmbeddingClient(16));
    await expect(retriever.search("query", { namespace: "docs" })).resolves.toEqual([]);
  });
});
