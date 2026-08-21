export interface RagVectorRecord {
  id: string;
  vector: number[];
  namespace: string;
  documentId: string;
  source: string;
  chunkIndex: number;
}

export interface RagVectorHit {
  chunkId: string;
  score: number;
}

export interface RagVectorSearchOptions {
  namespace: string;
  limit: number;
  minScore?: number;
  documentId?: string;
}

export interface RagVectorStore {
  initialize(): Promise<void>;
  upsert(records: RagVectorRecord[]): Promise<void>;
  search(vector: number[], options: RagVectorSearchOptions): Promise<RagVectorHit[]>;
  deleteChunkIds(chunkIds: string[]): Promise<void>;
  deleteByDocumentId(namespace: string, documentId: string): Promise<void>;
}
