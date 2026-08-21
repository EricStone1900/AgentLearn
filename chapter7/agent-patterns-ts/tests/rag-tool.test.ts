import { describe, expect, it, vi } from "vitest";
import type { RagToolService } from "../src/tools/rag-tool.js";
import { createRagTool } from "../src/tools/rag-tool.js";
import { ToolRegistry } from "../src/tools/tool.js";

function createFakeService(): RagToolService {
  return {
    ingestText: vi.fn(async () => ({
      documentId: "doc-1", chunkCount: 2, replaced: false,
    })),
    ingestFile: vi.fn(async () => ({
      documentId: "doc-2", chunkCount: 3, replaced: false,
    })),
    search: vi.fn(async () => []),
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