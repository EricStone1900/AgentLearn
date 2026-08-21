import type { RagChunk, RagDocument, RagStats } from "../schemas.js";

export interface RagDocumentStore {
  initialize(): Promise<void>;
  getDocument(
    namespace: string,
    documentId: string,
  ): Promise<RagDocument | undefined>;
  getChunksByDocument(namespace: string, documentId: string): Promise<RagChunk[]>;
  getChunksByIds(namespace: string, chunkIds: string[]): Promise<RagChunk[]>;
  replaceDocument(document: RagDocument, chunks: RagChunk[]): Promise<void>;
  deleteDocument(namespace: string, documentId: string): Promise<boolean>;
  getStats(namespace: string): Promise<RagStats>;
}
