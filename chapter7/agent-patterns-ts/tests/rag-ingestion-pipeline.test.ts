import { describe, expect, it } from "vitest";
import type { EmbeddingClient } from "../src/memory/embedding.js";
import type { DocumentLoader, LoadFileOptions } from "../src/rag/document-loader.js";
import { sha256 } from "../src/rag/ids.js";
import { RagIngestionPipeline } from "../src/rag/ingestion-pipeline.js";
import { MarkdownSplitter } from "../src/rag/markdown-splitter.js";
import type { LoadedRagDocument, RagChunk, RagDocument, RagStats } from "../src/rag/schemas.js";
import type { RagDocumentStore } from "../src/rag/storage/rag-document-store.js";
import type {
  RagVectorHit,
  RagVectorRecord,
  RagVectorSearchOptions,
  RagVectorStore,
} from "../src/rag/storage/rag-vector-store.js";

class FakeLoader implements DocumentLoader {
  public text = "第一段知识。\n\n第二段知识。";

  public async loadFile(
    filePath: string,
    options: LoadFileOptions,
  ): Promise<LoadedRagDocument> {
    return this.create(filePath, options);
  }

  public async loadText(
    text: string,
    source: string,
    options: LoadFileOptions,
  ): Promise<LoadedRagDocument> {
    this.text = text;
    return this.create(source, options);
  }

  private create(source: string, options: LoadFileOptions): LoadedRagDocument {
    return {
      id: options.documentId ?? "document-id",
      namespace: options.namespace,
      source,
      title: source,
      markdown: this.text,
      contentHash: sha256(this.text),
      metadata: {},
    };
  }
}

class FakeDocuments implements RagDocumentStore {
  public document: RagDocument | undefined;
  public chunks: RagChunk[] = [];
  public failReplace = false;

  public async initialize(): Promise<void> {}
  public async getDocument(namespace: string): Promise<RagDocument | undefined> {
    return this.document?.namespace === namespace ? this.document : undefined;
  }
  public async getChunksByDocument(namespace: string): Promise<RagChunk[]> {
    return this.chunks.filter((chunk) => chunk.namespace === namespace);
  }
  public async getChunksByIds(
    namespace: string,
    ids: string[],
  ): Promise<RagChunk[]> {
    return ids.flatMap((id) => this.chunks.filter(
      (chunk) => chunk.namespace === namespace && chunk.id === id,
    ));
  }
  public async replaceDocument(document: RagDocument, chunks: RagChunk[]): Promise<void> {
    if (this.failReplace) throw new Error("sqlite failed");
    this.document = document;
    this.chunks = [...chunks];
  }
  public async deleteDocument(namespace: string): Promise<boolean> {
    const existed = this.document?.namespace === namespace;
    if (!existed) return false;
    this.document = undefined;
    this.chunks = [];
    return existed;
  }
  public async getStats(): Promise<RagStats> {
    return { documents: this.document ? 1 : 0, chunks: this.chunks.length };
  }
}

class FakeVectors implements RagVectorStore {
  public upserted: RagVectorRecord[] = [];
  public deleted: string[][] = [];
  public failUpsert = false;
  public failDelete = false;

  public async initialize(): Promise<void> {}
  public async upsert(records: RagVectorRecord[]): Promise<void> {
    if (this.failUpsert) throw new Error("qdrant failed");
    this.upserted.push(...records);
  }
  public async search(
    _vector: number[],
    _options: RagVectorSearchOptions,
  ): Promise<RagVectorHit[]> {
    return [];
  }
  public async deleteChunkIds(ids: string[]): Promise<void> {
    if (this.failDelete) throw new Error("delete failed");
    this.deleted.push([...ids]);
  }
  public async deleteByDocumentId(): Promise<void> {}
}

class CountingEmbeddings implements EmbeddingClient {
  public readonly dimension = 4;
  public batchCalls = 0;
  public async embed(): Promise<number[]> {
    return [1, 0, 0, 0];
  }
  public async embedBatch(texts: string[]): Promise<number[][]> {
    this.batchCalls += 1;
    return texts.map(() => [1, 0, 0, 0]);
  }
}

function createFixture() {
  const loader = new FakeLoader();
  const documents = new FakeDocuments();
  const vectors = new FakeVectors();
  const embeddings = new CountingEmbeddings();
  const splitter = new MarkdownSplitter({ chunkTokens: 8, overlapTokens: 0 });
  const pipeline = new RagIngestionPipeline(
    loader,
    splitter,
    documents,
    vectors,
    embeddings,
    "index-v1",
    () => new Date("2026-01-01T00:00:00.000Z"),
  );
  return { loader, documents, vectors, embeddings, splitter, pipeline };
}

describe("RagIngestionPipeline", () => {
  it("首次导入会向量化、写向量并保存文档", async () => {
    const fixture = createFixture();
    const result = await fixture.pipeline.ingestFile("guide.md", { namespace: "docs" });
    expect(result.chunkCount).toBeGreaterThan(0);
    expect(fixture.embeddings.batchCalls).toBe(1);
    expect(fixture.vectors.upserted).toHaveLength(result.chunkCount);
    expect(fixture.documents.document?.source).toBe("guide.md");
  });

  it("内容哈希未变化时不会重复 Embedding", async () => {
    const fixture = createFixture();
    await fixture.pipeline.ingestFile("guide.md", { namespace: "docs" });
    const second = await fixture.pipeline.ingestFile("guide.md", { namespace: "docs" });
    expect(second.replaced).toBe(false);
    expect(fixture.embeddings.batchCalls).toBe(1);
  });

  it("indexFingerprint 变化时会重新生成索引", async () => {
    const fixture = createFixture();
    await fixture.pipeline.ingestFile("guide.md", { namespace: "docs" });
    const upgradedPipeline = new RagIngestionPipeline(
      fixture.loader,
      fixture.splitter,
      fixture.documents,
      fixture.vectors,
      fixture.embeddings,
      "index-v2",
      () => new Date("2026-01-02T00:00:00.000Z"),
    );

    const result = await upgradedPipeline.ingestFile("guide.md", {
      namespace: "docs",
    });

    expect(result.replaced).toBe(true);
    expect(fixture.embeddings.batchCalls).toBe(2);
    expect(fixture.documents.document?.indexFingerprint).toBe("index-v2");
  });

  it("文档更新后删除旧的 stale IDs", async () => {
    const fixture = createFixture();
    await fixture.pipeline.ingestFile("guide.md", { namespace: "docs" });
    const oldIds = fixture.documents.chunks.map((chunk) => chunk.id);
    fixture.loader.text = "完全不同的新知识。";
    await fixture.pipeline.ingestFile("guide.md", { namespace: "docs" });
    expect(fixture.vectors.deleted.flat()).toEqual(expect.arrayContaining(oldIds));
  });

  it("SQLite replace 失败时补偿本次新向量", async () => {
    const fixture = createFixture();
    fixture.documents.failReplace = true;
    await expect(fixture.pipeline.ingestFile("guide.md", { namespace: "docs" }))
      .rejects.toThrow("sqlite failed");
    expect(fixture.vectors.deleted.flat().length).toBeGreaterThan(0);
    expect(fixture.documents.document).toBeUndefined();
  });

  it("Qdrant upsert 失败时不写 SQLite", async () => {
    const fixture = createFixture();
    fixture.vectors.failUpsert = true;
    await expect(fixture.pipeline.ingestFile("guide.md", { namespace: "docs" }))
      .rejects.toThrow("qdrant failed");
    expect(fixture.documents.document).toBeUndefined();
  });

  it("删除向量失败时保留 SQLite 权威文档", async () => {
    const fixture = createFixture();
    await fixture.pipeline.ingestFile("guide.md", { namespace: "docs" });
    fixture.vectors.failDelete = true;
    await expect(fixture.pipeline.deleteDocument("docs", "document-id"))
      .rejects.toThrow("delete failed");
    expect(fixture.documents.document).toBeDefined();
  });

  it("不能跨 namespace 删除文档", async () => {
    const fixture = createFixture();
    await fixture.pipeline.ingestFile("guide.md", { namespace: "docs" });

    await expect(fixture.pipeline.deleteDocument("other", "document-id"))
      .resolves.toBe(false);
    expect(fixture.documents.document).toBeDefined();
  });
});
