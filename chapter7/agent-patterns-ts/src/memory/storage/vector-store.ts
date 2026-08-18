import { cosineSimilarity } from "../scoring.js";

export interface VectorRecord {
  id: string;
  vector: number[];
  metadata: Record<string, unknown>;
}

export interface VectorSearchFilter {
  userId?: string;
  memoryType?: string;
  modality?: string;
}

export interface VectorHit {
  id: string;
  score: number;
  metadata: Record<string, unknown>;
}

export interface VectorStore {
  upsert(records: VectorRecord[]): Promise<void>;
  search(
    vector: number[],
    limit: number,
    filter?: VectorSearchFilter,
  ): Promise<VectorHit[]>;
  delete(ids: string[]): Promise<void>;
  clear(filter?: VectorSearchFilter): Promise<void>;
}

function matches(
  metadata: Record<string, unknown>,
  filter: VectorSearchFilter,
): boolean {
  return (
    (!filter.userId || metadata.userId === filter.userId) &&
    (!filter.memoryType || metadata.memoryType === filter.memoryType) &&
    (!filter.modality || metadata.modality === filter.modality)
  );
}

export class InMemoryVectorStore implements VectorStore {
  private readonly records = new Map<string, VectorRecord>();

  public async upsert(records: VectorRecord[]): Promise<void> {
    for (const record of records)
      this.records.set(record.id, structuredClone(record));
  }

  public async search(
    vector: number[],
    limit: number,
    filter: VectorSearchFilter = {},
  ): Promise<VectorHit[]> {
    return [...this.records.values()]
      .filter((record) => matches(record.metadata, filter))
      .map((record) => ({
        id: record.id,
        score: cosineSimilarity(vector, record.vector),
        metadata: structuredClone(record.metadata),
      }))
      .sort((left, right) => right.score - left.score)
      .slice(0, limit);
  }

  public async delete(ids: string[]): Promise<void> {
    for (const id of ids) this.records.delete(id);
  }

  public async clear(filter: VectorSearchFilter = {}): Promise<void> {
    for (const [id, record] of this.records) {
      if (matches(record.metadata, filter)) this.records.delete(id);
    }
  }
}
