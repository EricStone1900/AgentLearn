import { describe, expect, it, vi } from "vitest";
import type { RagToolService } from "../src/tools/rag-tool.js";
import { createRagTool } from "../src/tools/rag-tool.js";
import { ToolRegistry } from "../src/tools/tool.js";

const searchDocument = {
  id: "doc-1",
  namespace: "manual",
  source: "guide.md",
  title: "Guide",
  markdown: "这是一整篇不应返回给工具的文档",
  contentHash: "document-hash",
  indexFingerprint: "index-v1",
  metadata: {},
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const searchChunk = {
  id: "chunk-1",
  documentId: "doc-1",
  namespace: "manual",
  chunkIndex: 0,
  content: "只返回相关片段",
  embeddingText: "只返回相关片段",
  headingPath: "检索",
  startOffset: 10,
  endOffset: 18,
  tokenCount: 8,
  contentHash: "chunk-hash",
  metadata: {},
};

function createFakeService(): RagToolService {
  return {
    ingestText: vi.fn(async () => ({
      documentId: "doc-1", chunkCount: 2, replaced: false,
    })),
    ingestFile: vi.fn(async () => ({
      documentId: "doc-2", chunkCount: 3, replaced: false,
    })),
    search: vi.fn(async () => [{
      chunk: searchChunk,
      document: searchDocument,
      score: 0.91,
    }]),
    ask: vi.fn(async () => ({ answer: "回答", citations: [] })),
    deleteDocument: vi.fn(async () => true),
    getStats: vi.fn(async () => ({ documents: 1, chunks: 2 })),
  };
}

describe("RAGTool", () => {
  it.each([
    [{ action: "add_text" }, "text"],
    [{ action: "add_file" }, "filePath"],
    [{ action: "search" }, "query"],
    [{ action: "ask" }, "query"],
    [{ action: "delete" }, "documentId"],
  ])("拒绝缺少动作必填字段的输入 %#", async (input, field) => {
    const registry = new ToolRegistry();
    registry.register(createRagTool(createFakeService()));
    const result = await registry.executeDetailed("rag", input);
    expect(result.ok).toBe(false);
    expect(result.output).toContain(field);
  });

  it("search 转发检索配置", async () => {
    const service = createFakeService();
    const registry = new ToolRegistry();
    registry.register(createRagTool(service));
    const result = await registry.executeDetailed("rag", {
      action: "search",
      query: "一致性",
      namespace: "manual",
      limit: 7,
      minScore: 0.4,
      enableMqe: true,
      enableHyde: false,
    });
    expect(result.ok).toBe(true);
    expect(service.search).toHaveBeenCalledWith("一致性", {
      namespace: "manual",
      limit: 7,
      minScore: 0.4,
      enableMqe: true,
      enableHyde: false,
    });

    if (!result.ok) throw new Error(result.error);
    const output = JSON.parse(result.output) as {
      results: Array<Record<string, unknown>>;
    };
    expect(output.results).toEqual([{
      chunkId: "chunk-1",
      documentId: "doc-1",
      content: "只返回相关片段",
      source: "guide.md",
      title: "Guide",
      headingPath: "检索",
      startOffset: 10,
      endOffset: 18,
      score: 0.91,
    }]);
    expect(result.output).not.toContain(searchDocument.markdown);
  });

  it("delete 转发 namespace 和 documentId", async () => {
    const service = createFakeService();
    const registry = new ToolRegistry();
    registry.register(createRagTool(service));

    const result = await registry.executeDetailed("rag", {
      action: "delete",
      namespace: "private",
      documentId: "doc-1",
    });

    expect(result.ok).toBe(true);
    expect(service.deleteDocument).toHaveBeenCalledWith("private", "doc-1");
  });

  it("stats 返回可解析 JSON", async () => {
    const registry = new ToolRegistry();
    registry.register(createRagTool(createFakeService()));
    const result = await registry.executeDetailed("rag", {
      action: "stats",
      namespace: "docs",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(JSON.parse(result.output)).toEqual({
      success: true,
      stats: { documents: 1, chunks: 2 },
    });
  });
});
