import { describe, expect, it } from "vitest";
import { MarkdownSplitter } from "../src/rag/markdown-splitter.js";
import type { LoadedRagDocument } from "../src/rag/schemas.js";

function document(markdown: string): LoadedRagDocument {
  return {
    id: "document-id",
    namespace: "test",
    source: "guide.md",
    title: "guide.md",
    markdown,
    contentHash: "hash",
    metadata: {},
  };
}

describe("MarkdownSplitter", () => {
  it("保留标题路径并生成多个 chunk", () => {
    const splitter = new MarkdownSplitter({ chunkTokens: 12, overlapTokens: 0 });
    const chunks = splitter.split(document(
      "# RAG\n\n第一段介绍检索增强生成。\n\n## 检索\n\n第二段介绍向量检索。",
    ));

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]?.headingPath).toBe("RAG");
    expect(chunks.at(-1)?.headingPath).toBe("RAG > 检索");
    expect(chunks.at(-1)?.embeddingText).toContain("RAG > 检索");
  });

  it("超长单段也不会突破太多", () => {
    const splitter = new MarkdownSplitter({ chunkTokens: 10, overlapTokens: 2 });
    const chunks = splitter.split(document("这是一个没有任何空行的超长中文段落".repeat(8)));
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.tokenCount <= 12)).toBe(true);
  });

  it("拒绝可能无法前进的 overlap 配置", () => {
    expect(() => new MarkdownSplitter({ chunkTokens: 10, overlapTokens: 10 })).toThrow();
  });
});