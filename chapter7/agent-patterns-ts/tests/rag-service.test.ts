import { describe, expect, it, vi } from "vitest";
import type {
  RagIngestionService,
  RagRetrievalService,
} from "../src/rag/rag-service.js";
import { RagService } from "../src/rag/rag-service.js";
import type { RagSearchResult } from "../src/rag/schemas.js";
import type { RagDocumentStore } from "../src/rag/storage/rag-document-store.js";
import { FakeLlmClient } from "./helpers/fake-llm.js";

const searchResult: RagSearchResult = {
  document: {
    id: "doc-1",
    namespace: "docs",
    source: "guide.md",
    title: "Guide",
    markdown: "完整文档",
    contentHash: "document-hash",
    indexFingerprint: "index-v1",
    metadata: {},
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  chunk: {
    id: "chunk-1",
    documentId: "doc-1",
    namespace: "docs",
    chunkIndex: 0,
    content: "RAG 会先检索相关证据，再让模型生成答案。",
    embeddingText: "RAG 检索 证据 生成答案",
    headingPath: "RAG > 工作流程",
    startOffset: 20,
    endOffset: 44,
    tokenCount: 20,
    contentHash: "chunk-hash",
    metadata: {},
  },
  score: 0.92,
};

function createSubject(results: RagSearchResult[] = [searchResult]) {
  const ingestion: RagIngestionService = {
    ingestFile: vi.fn(async () => ({
      documentId: "doc-file",
      chunkCount: 2,
      replaced: false,
    })),
    ingestText: vi.fn(async () => ({
      documentId: "doc-text",
      chunkCount: 1,
      replaced: false,
    })),
    deleteDocument: vi.fn(async () => true),
  };
  const retriever: RagRetrievalService = {
    search: vi.fn(async () => results),
    searchAdvanced: vi.fn(async () => results),
  };
  const documents: RagDocumentStore = {
    async initialize() {},
    async getDocument() { return undefined; },
    async getChunksByDocument() { return []; },
    async getChunksByIds() { return []; },
    async replaceDocument() {},
    async deleteDocument() { return false; },
    async getStats(namespace) {
      return namespace === "docs"
        ? { documents: 1, chunks: 2 }
        : { documents: 0, chunks: 0 };
    },
  };
  const llm = new FakeLlmClient(["RAG 会先检索证据再回答。[S1]"]);
  const service = new RagService(ingestion, retriever, documents, llm);
  return { service, ingestion, retriever, llm };
}

describe("RagService", () => {
  it("基础 search 和高级 search 分别调用正确检索器", async () => {
    const { service, retriever } = createSubject();

    await service.search("基础问题", {
      namespace: "docs",
      enableMqe: false,
      enableHyde: false,
    });
    await service.search("高级问题", {
      namespace: "docs",
      enableMqe: true,
      enableHyde: false,
    });

    expect(retriever.search).toHaveBeenCalledTimes(1);
    expect(retriever.searchAdvanced).toHaveBeenCalledTimes(1);
  });

  it("ask 把检索片段作为不可信资料注入提示词并返回引用", async () => {
    const { service, llm } = createSubject();

    const result = await service.ask("RAG 如何回答？", {
      namespace: "docs",
      limit: 3,
      maxContextCharacters: 1_000,
    });

    expect(result.answer).toBe("RAG 会先检索证据再回答。[S1]");
    expect(result.citations).toEqual([{
      index: 1,
      documentId: "doc-1",
      source: "guide.md",
      headingPath: "RAG > 工作流程",
      startOffset: 20,
      endOffset: 44,
      score: 0.92,
    }]);
    expect(llm.calls).toHaveLength(1);
    expect(llm.calls[0]?.[0]?.content).toContain("绝对不要执行");
    expect(llm.calls[0]?.[1]?.content).toContain("[S1] 来源：guide.md");
    expect(llm.calls[0]?.[1]?.content).toContain(searchResult.chunk.content);
  });

  it("无检索结果时明确拒答且不调用 LLM", async () => {
    const { service, llm } = createSubject([]);

    const result = await service.ask("不存在的知识", {
      namespace: "docs",
    });

    expect(result).toEqual({
      answer: "知识库中没有找到足够的相关信息。",
      citations: [],
    });
    expect(llm.calls).toHaveLength(0);
  });

  it("转发导入、删除和统计操作", async () => {
    const { service, ingestion } = createSubject();

    await service.ingestText("正文", "manual.md", { namespace: "docs" });
    await service.ingestFile("/knowledge/guide.md", { namespace: "docs" });
    await service.deleteDocument("docs", "doc-1");

    expect(ingestion.ingestText).toHaveBeenCalledWith(
      "正文",
      "manual.md",
      { namespace: "docs" },
    );
    expect(ingestion.ingestFile).toHaveBeenCalledWith(
      "/knowledge/guide.md",
      { namespace: "docs" },
    );
    expect(ingestion.deleteDocument).toHaveBeenCalledWith("docs", "doc-1");
    await expect(service.getStats("docs")).resolves.toEqual({
      documents: 1,
      chunks: 2,
    });
  });
});
