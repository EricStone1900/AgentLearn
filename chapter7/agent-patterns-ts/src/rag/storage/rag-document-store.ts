import type { RagChunk, RagDocument, RagStats } from "../schemas.js";

export interface RagDocumentStore {
  initialize(): Promise<void>;
  getDocument(documentId: string): Promise<RagDocument | undefined>;
  getChunksByDocument(documentId: string): Promise<RagChunk[]>;
  getChunksByIds(chunkIds: string[]): Promise<RagChunk[]>;
  replaceDocument(document: RagDocument, chunks: RagChunk[]): Promise<void>;
  deleteDocument(documentId: string): Promise<boolean>;
  getStats(namespace: string): Promise<RagStats>;
}