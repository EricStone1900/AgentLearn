import { describe, expect, it } from "vitest";
import {
  createChunkId,
  createDocumentId,
  createRagIndexFingerprint,
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

  it("索引关键配置变化会改变 fingerprint", () => {
    const base = {
      collectionName: "rag-v1",
      embeddingBaseUrl: "https://embedding.example/v1",
      embeddingModel: "embedding-model",
      embeddingDimension: 1024,
      chunkTokens: 800,
      overlapTokens: 100,
      preprocessingVersion: "markdown-v1",
    };

    expect(createRagIndexFingerprint(base)).not.toBe(
      createRagIndexFingerprint({
        ...base,
        embeddingModel: "embedding-model-v2",
      }),
    );
    expect(createRagIndexFingerprint(base)).not.toBe(
      createRagIndexFingerprint({
        ...base,
        chunkTokens: 600,
      }),
    );
  });
});
