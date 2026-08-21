import { describe, expect, it } from "vitest";
import type { LlmClient, MessageData } from "../src/core/types.js";
import type { EmbeddingClient } from "../src/memory/embedding.js";
import { RagRetriever } from "../src/rag/retriever.js";
import type { RagChunk, RagDocument } from "../src/rag/schemas.js";
import type { RagDocumentStore } from "../src/rag/storage/rag-document-store.js";
import type {
  RagVectorHit,
  RagVectorSearchOptions,
  RagVectorStore,
} from "../src/rag/storage/rag-vector-store.js";

function createDocument(id: string): RagDocument {
  return {
    id,
    namespace: "docs",
    source: `${id}.md`,
    title: id,
    markdown: `文档 ${id}`,
    contentHash: `document-hash-${id}`,
    indexFingerprint: "index-v1",
    metadata: {},
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function createChunk(id: string, documentId: string): RagChunk {
  return {
    id,
    documentId,
    namespace: "docs",
    chunkIndex: 0,
    content: `片段 ${id}`,
    embeddingText: `片段 ${id}`,
    startOffset: 0,
    endOffset: 5,
    tokenCount: 3,
    contentHash: `chunk-hash-${id}`,
    metadata: {},
  };
}

const documentsById = new Map([
  ["doc-a", createDocument("doc-a")],
  ["doc-b", createDocument("doc-b")],
  ["doc-c", createDocument("doc-c")],
]);

const chunksById = new Map([
  ["chunk-a", createChunk("chunk-a", "doc-a")],
  ["chunk-b", createChunk("chunk-b", "doc-b")],
  ["chunk-c", createChunk("chunk-c", "doc-c")],
]);

const documentStore: RagDocumentStore = {
  async initialize() {},
  async getDocument(namespace, documentId) {
    return namespace === "docs" ? documentsById.get(documentId) : undefined;
  },
  async getChunksByDocument(namespace, documentId) {
    return namespace === "docs"
      ? [...chunksById.values()].filter((chunk) => chunk.documentId === documentId)
      : [];
  },
  async getChunksByIds(namespace, chunkIds) {
    if (namespace !== "docs") return [];
    return chunkIds.flatMap((id) => {
      const chunk = chunksById.get(id);
      return chunk ? [chunk] : [];
    });
  },
  async replaceDocument() {},
  async deleteDocument() { return true; },
  async getStats() { return { documents: 3, chunks: 3 }; },
};

class RecordingEmbeddings implements EmbeddingClient {
  public readonly dimension = 1;
  public readonly texts: string[] = [];

  public async embed(text: string): Promise<number[]> {
    this.texts.push(text);
    const values: Record<string, number> = {
      "原始问题": 1,
      "扩展一": 2,
      "扩展二": 3,
      "假设答案段落": 4,
    };
    return [values[text] ?? 9];
  }

  public async embedBatch(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map((text) => this.embed(text)));
  }
}

class RecordingVectors implements RagVectorStore {
  public readonly searches: Array<{
    vector: number[];
    options: RagVectorSearchOptions;
  }> = [];

  public async initialize(): Promise<void> {}
  public async upsert(): Promise<void> {}
  public async deleteChunkIds(): Promise<void> {}
  public async deleteByDocumentId(): Promise<void> {}

  public async search(
    vector: number[],
    options: RagVectorSearchOptions,
  ): Promise<RagVectorHit[]> {
    this.searches.push({ vector, options });
    switch (vector[0]) {
      case 1:
        return [
          { chunkId: "chunk-a", score: 0.5 },
          { chunkId: "chunk-b", score: 0.4 },
        ];
      case 2:
        return [
          { chunkId: "chunk-b", score: 0.9 },
          { chunkId: "chunk-a", score: 0.4 },
        ];
      case 3:
        return [{ chunkId: "chunk-c", score: 0.8 }];
      case 4:
        return [{ chunkId: "chunk-a", score: 0.95 }];
      default:
        return [];
    }
  }
}

class ExpansionLlm implements LlmClient {
  public readonly calls: MessageData[][] = [];

  public async generate(messages: MessageData[]): Promise<string> {
    this.calls.push(messages);
    const system = messages[0]?.content ?? "";
    if (system.includes("查询扩展")) {
      return "- 扩展一\n2. 扩展二\n原始问题";
    }
    return "假设答案段落";
  }
}

describe("RagRetriever advanced search", () => {
  it("合并 MQE 和 HyDE 结果，按 chunkId 去重并保留最高分", async () => {
    const embeddings = new RecordingEmbeddings();
    const vectors = new RecordingVectors();
    const llm = new ExpansionLlm();
    const retriever = new RagRetriever(documentStore, vectors, embeddings, llm);

    const results = await retriever.searchAdvanced("原始问题", {
      namespace: "docs",
      limit: 3,
      minScore: 0.2,
      enableMqe: true,
      mqeExpansions: 3,
      enableHyde: true,
      candidatePoolMultiplier: 2,
    });

    expect(llm.calls).toHaveLength(2);
    expect(embeddings.texts).toEqual([
      "原始问题",
      "扩展一",
      "扩展二",
      "假设答案段落",
    ]);
    expect(results.map((result) => [result.chunk.id, result.score])).toEqual([
      ["chunk-a", 0.95],
      ["chunk-b", 0.9],
      ["chunk-c", 0.8],
    ]);
    expect(vectors.searches.every(
      ({ options }) => options.namespace === "docs" && options.minScore === 0.2,
    )).toBe(true);
  });

  it("MQE 和 HyDE 调用失败时回退到原始查询", async () => {
    const embeddings = new RecordingEmbeddings();
    const vectors = new RecordingVectors();
    const failingLlm: LlmClient = {
      async generate() {
        throw new Error("llm unavailable");
      },
    };
    const retriever = new RagRetriever(
      documentStore,
      vectors,
      embeddings,
      failingLlm,
    );

    const results = await retriever.searchAdvanced("原始问题", {
      namespace: "docs",
      limit: 2,
      enableMqe: true,
      enableHyde: true,
    });

    expect(embeddings.texts).toEqual(["原始问题"]);
    expect(vectors.searches).toHaveLength(1);
    expect(results.map((result) => result.chunk.id)).toEqual([
      "chunk-a",
      "chunk-b",
    ]);
  });

  it("高级检索拒绝空查询", async () => {
    const retriever = new RagRetriever(
      documentStore,
      new RecordingVectors(),
      new RecordingEmbeddings(),
      new ExpansionLlm(),
    );

    await expect(retriever.searchAdvanced("   ", {
      namespace: "docs",
      enableMqe: true,
    })).rejects.toThrow("RAG 查询不能为空");
  });

  it("启用高级检索但未提供 LLM 时明确失败", async () => {
    const retriever = new RagRetriever(
      documentStore,
      new RecordingVectors(),
      new RecordingEmbeddings(),
    );

    await expect(retriever.searchAdvanced("原始问题", {
      namespace: "docs",
      enableHyde: true,
    })).rejects.toThrow("高级 RAG 检索需要 LlmClient");
  });
});
