import { describe, expect, it } from "vitest";
import {
  createChunkId,
  createDocumentId,
  deterministicUuid,
} from "../src/rag/ids.js";

describe("RAG IDs", () => {
  it("相同输入生成相同 UUID", () => {
    expect(deterministicUuid("same")).toBe(deterministicUuid("same"));
    expect(deterministicUuid("same")).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("namespace、来源和内容变化会改变 ID", () => {
    expect(createDocumentId("a", "guide.md")).not.toBe(
      createDocumentId("b", "guide.md"),
    );
    expect(createChunkId("doc", 0, "hash-a")).not.toBe(
      createChunkId("doc", 0, "hash-b"),
    );
  });
});