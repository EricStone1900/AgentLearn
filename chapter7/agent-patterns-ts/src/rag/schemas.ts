import { z } from "zod";

export const ragMetadataSchema = z.record(z.string(), z.unknown());

export interface RagDocument {
  id: string;
  namespace: string;
  source: string;
  title: string;
  markdown: string;
  contentHash: string;
  indexFingerprint: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface RagChunk {
  id: string;
  documentId: string;
  namespace: string;
  chunkIndex: number;
  content: string;
  embeddingText: string;
  headingPath?: string;
  startOffset: number;
  endOffset: number;
  tokenCount: number;
  contentHash: string;
  metadata: Record<string, unknown>;
}

export interface LoadedRagDocument {
  id: string;
  namespace: string;
  source: string;
  title: string;
  markdown: string;
  contentHash: string;
  metadata: Record<string, unknown>;
}

export interface RagSearchOptions {
  namespace: string;
  limit?: number;
  minScore?: number;
  documentId?: string;
}

export interface RagSearchResult {
  chunk: RagChunk;
  document: RagDocument;
  score: number;
}

export interface RagStats {
  documents: number;
  chunks: number;
}

export interface RagIngestionResult {
  documentId: string;
  chunkCount: number;
  replaced: boolean;
}
