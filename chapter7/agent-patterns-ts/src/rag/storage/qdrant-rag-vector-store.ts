import type { QdrantClient } from "@qdrant/js-client-rest";
import type {
  RagVectorHit,
  RagVectorRecord,
  RagVectorSearchOptions,
  RagVectorStore,
} from "./rag-vector-store.js";

export interface QdrantRagVectorStoreOptions {
  client: QdrantClient;
  collectionName: string;
  dimension: number;
}

function vectorSize(vectors: unknown): number | undefined {
  if (!vectors || typeof vectors !== "object" || !("size" in vectors)) return undefined;
  return typeof vectors.size === "number" ? vectors.size : undefined;
}

export class QdrantRagVectorStore implements RagVectorStore {
  private readonly ready: Promise<void>;

  public constructor(private readonly options: QdrantRagVectorStoreOptions) {
    if (!Number.isInteger(options.dimension) || options.dimension < 1) {
      throw new Error("RAG Qdrant dimension 必须是正整数");
    }
    this.ready = this.ensureCollection();
  }

  private async ensureCollection(): Promise<void> {
    const collections = await this.options.client.getCollections();
    const exists = collections.collections.some(
      (item) => item.name === this.options.collectionName,
    );
    if (!exists) {
      await this.options.client.createCollection(this.options.collectionName, {
        vectors: { size: this.options.dimension, distance: "Cosine" },
      });
    } else {
      const info = await this.options.client.getCollection(this.options.collectionName);
      const actual = vectorSize(info.config.params.vectors);
      if (actual !== this.options.dimension) {
        throw new Error(
          `RAG collection 维度不匹配：期望 ${this.options.dimension}，实际 ${String(actual)}`,
        );
      }
    }

    for (const fieldName of ["namespace", "documentId", "source"]) {
      await this.options.client.createPayloadIndex(this.options.collectionName, {
        field_name: fieldName,
        field_schema: "keyword",
        wait: true,
      });
    }
  }

  public async initialize(): Promise<void> {
    await this.ready;
  }

  public async upsert(records: RagVectorRecord[]): Promise<void> {
    if (records.length === 0) return;
    await this.ready;
    for (const record of records) {
      if (record.vector.length !== this.options.dimension) {
        throw new Error(`chunk ${record.id} 向量维度不匹配`);
      }
    }
    await this.options.client.upsert(this.options.collectionName, {
      wait: true,
      points: records.map((record) => ({
        id: record.id,
        vector: record.vector,
        payload: {
          chunkId: record.id,
          namespace: record.namespace,
          documentId: record.documentId,
          source: record.source,
          chunkIndex: record.chunkIndex,
        },
      })),
    });
  }

  public async search(
    vector: number[],
    options: RagVectorSearchOptions,
  ): Promise<RagVectorHit[]> {
    await this.ready;
    if (vector.length !== this.options.dimension) {
      throw new Error("RAG 查询向量维度不匹配");
    }
    const must: Array<{ key: string; match: { value: string } }> = [
      { key: "namespace", match: { value: options.namespace } },
    ];
    if (options.documentId) {
      must.push({ key: "documentId", match: { value: options.documentId } });
    }
    const response = await this.options.client.query(this.options.collectionName, {
      query: vector,
      limit: options.limit,
      filter: { must },
      with_payload: true,
      with_vector: false,
      ...(options.minScore === undefined ? {} : { score_threshold: options.minScore }),
    });
    return response.points.map((point) => ({
      chunkId: String(point.payload?.chunkId ?? point.id),
      score: point.score,
    }));
  }

  public async deleteChunkIds(chunkIds: string[]): Promise<void> {
    if (chunkIds.length === 0) return;
    await this.ready;
    await this.options.client.delete(this.options.collectionName, {
      wait: true,
      points: chunkIds,
    });
  }

  public async deleteByDocumentId(
    namespace: string,
    documentId: string,
  ): Promise<void> {
    await this.ready;
    await this.options.client.delete(this.options.collectionName, {
      wait: true,
      filter: {
        must: [
          { key: "namespace", match: { value: namespace } },
          { key: "documentId", match: { value: documentId } },
        ],
      },
    });
  }
}
