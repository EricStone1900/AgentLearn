import type { EmbeddingClient } from "../memory/embedding.js";
import type { DocumentLoader, LoadFileOptions } from "./document-loader.js";
import { MarkdownSplitter } from "./markdown-splitter.js";
import type { RagDocumentStore } from "./storage/rag-document-store.js";
import type { RagVectorStore } from "./storage/rag-vector-store.js";
import type { LoadedRagDocument, RagDocument, RagIngestionResult } from "./schemas.js";

export class RagIngestionPipeline {
  public constructor(
    private readonly loader: DocumentLoader,
    private readonly splitter: MarkdownSplitter,
    private readonly documents: RagDocumentStore,
    private readonly vectors: RagVectorStore,
    private readonly embeddings: EmbeddingClient,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public async ingestFile(
    filePath: string,
    options: LoadFileOptions,
  ): Promise<RagIngestionResult> {
    return this.ingestLoaded(await this.loader.loadFile(filePath, options));
  }

  public async ingestText(
    text: string,
    source: string,
    options: LoadFileOptions,
  ): Promise<RagIngestionResult> {
    return this.ingestLoaded(await this.loader.loadText(text, source, options));
  }

  private async ingestLoaded(loaded: LoadedRagDocument): Promise<RagIngestionResult> {
    const previous = await this.documents.getDocument(loaded.id);
    if (previous?.contentHash === loaded.contentHash) {
      const existingChunks = await this.documents.getChunksByDocument(loaded.id);
      return { documentId: loaded.id, chunkCount: existingChunks.length, replaced: false };
    }

    const oldChunks = await this.documents.getChunksByDocument(loaded.id);
    const chunks = this.splitter.split(loaded);
    if (chunks.length === 0) throw new Error("文档切分后没有有效 chunk");

    const embedded = await this.embeddings.embedBatch(
      chunks.map((chunk) => chunk.embeddingText),
    );
    if (embedded.length !== chunks.length) {
      throw new Error("Embedding 数量与 chunk 数量不一致");
    }

    const oldIds = new Set(oldChunks.map((chunk) => chunk.id));
    const newIds = new Set(chunks.map((chunk) => chunk.id));
    const introducedIds = [...newIds].filter((id) => !oldIds.has(id));
    const staleIds = [...oldIds].filter((id) => !newIds.has(id));

    await this.vectors.upsert(chunks.map((chunk, index) => {
      const vector = embedded[index];
      if (!vector) throw new Error(`缺少第 ${index} 个 chunk 的向量`);
      return {
        id: chunk.id,
        vector,
        namespace: chunk.namespace,
        documentId: chunk.documentId,
        source: loaded.source,
        chunkIndex: chunk.chunkIndex,
      };
    }));

    const timestamp = this.now().toISOString();
    const document: RagDocument = {
      ...loaded,
      createdAt: previous?.createdAt ?? timestamp,
      updatedAt: timestamp,
    };

    try {
      await this.documents.replaceDocument(document, chunks);
    } catch (error: unknown) {
      // 只删除本次新引入的 ID，不能删除与旧版本共有的向量。
      await this.vectors.deleteChunkIds(introducedIds);
      throw error;
    }

    // SQLite 已提交后再清理旧向量。失败必须向上抛出，不能返回成功。
    await this.vectors.deleteChunkIds(staleIds);
    return { documentId: loaded.id, chunkCount: chunks.length, replaced: previous !== undefined };
  }

  public async deleteDocument(documentId: string): Promise<boolean> {
    const chunks = await this.documents.getChunksByDocument(documentId);
    if (chunks.length === 0 && !(await this.documents.getDocument(documentId))) return false;

    // 先删 Qdrant；失败时保留 SQLite 权威文档，方便重试。
    await this.vectors.deleteChunkIds(chunks.map((chunk) => chunk.id));
    return this.documents.deleteDocument(documentId);
  }
}