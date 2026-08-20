import { QdrantClient } from "@qdrant/js-client-rest";
import type {
  VectorHit,
  VectorRecord,
  VectorSearchFilter,
  VectorStore,
} from "./vector-store.js";

export interface QdrantVectorStoreOptions {
  client: QdrantClient;
  collectionName: string;
  dimension: number;
}

function buildFilter(filter: VectorSearchFilter): {
  must: Array<{
    key: string;
    match: { value: string };
  }>;
} {
  const must: Array<{
    key: string;
    match: { value: string };
  }> = [];

  if (filter.userId) {
    must.push({ key: "userId", match: { value: filter.userId } });
  }
  if (filter.memoryType) {
    must.push({
      key: "memoryType",
      match: { value: filter.memoryType },
    });
  }
  if (filter.modality) {
    must.push({ key: "modality", match: { value: filter.modality } });
  }

  return { must };
}

function payloadToMetadata(
  payload: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  return payload ? structuredClone(payload) : {};
}

function readUnnamedVectorSize(vectors: unknown): number | undefined {
  if (
    typeof vectors !== "object" ||
    vectors === null ||
    !("size" in vectors)
  ) {
    return undefined;
  }

  const size = vectors.size;
  return typeof size === "number" ? size : undefined;
}

export class QdrantVectorStore implements VectorStore {
  private readonly ready: Promise<void>;

  public constructor(private readonly options: QdrantVectorStoreOptions) {
    if (!Number.isInteger(options.dimension) || options.dimension <= 0) {
      throw new Error("Qdrant 向量维度必须是正整数");
    }
    this.ready = this.ensureCollection();
  }

  private async ensureCollection(): Promise<void> {
    const collections = await this.options.client.getCollections();
    const exists = collections.collections.some(
      (collection) => collection.name === this.options.collectionName,
    );

    if (!exists) {
      await this.options.client.createCollection(
        this.options.collectionName,
        {
          vectors: {
            size: this.options.dimension,
            distance: "Cosine",
          },
        },
      );
    } else {
      const collection = await this.options.client.getCollection(
        this.options.collectionName,
      );
      const actualDimension = readUnnamedVectorSize(
        collection.config.params.vectors,
      );

      if (actualDimension !== this.options.dimension) {
        throw new Error(
          [
            `Qdrant collection ${this.options.collectionName} 维度不匹配：`,
            `期望 ${this.options.dimension}，`,
            `实际 ${String(actualDimension ?? "未知")}。`,
            "更换模型或维度时请使用新的 collection 名称。",
          ].join(""),
        );
      }
    }

    for (const fieldName of ["userId", "memoryType", "modality"]) {
      await this.options.client.createPayloadIndex(
        this.options.collectionName,
        {
          field_name: fieldName,
          field_schema: "keyword",
          wait: true,
        },
      );
    }
  }

  public async initialize(): Promise<void> {
    await this.ready;
  }

  public async upsert(records: VectorRecord[]): Promise<void> {
    if (records.length === 0) return;
    await this.ready;

    for (const record of records) {
      if (record.vector.length !== this.options.dimension) {
        throw new Error(
          `向量 ${record.id} 维度不匹配：期望 ${this.options.dimension}，实际 ${record.vector.length}`,
        );
      }
    }

    await this.options.client.upsert(this.options.collectionName, {
      wait: true,
      points: records.map((record) => ({
        id: record.id,
        vector: record.vector,
        payload: record.metadata,
      })),
    });
  }

  public async search(
    vector: number[],
    limit: number,
    filter: VectorSearchFilter = {},
  ): Promise<VectorHit[]> {
    await this.ready;

    if (vector.length !== this.options.dimension) {
      throw new Error(
        `查询向量维度不匹配：期望 ${this.options.dimension}，实际 ${vector.length}`,
      );
    }

    const response = await this.options.client.query(
      this.options.collectionName,
      {
        query: vector,
        limit,
        filter: buildFilter(filter),
        with_payload: true,
        with_vector: false,
      },
    );

    return response.points.map((hit) => ({
      id: String(hit.id),
      score: hit.score,
      metadata: payloadToMetadata(hit.payload),
    }));
  }

  public async delete(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.ready;

    await this.options.client.delete(this.options.collectionName, {
      wait: true,
      points: ids,
    });
  }

  public async clear(filter: VectorSearchFilter = {}): Promise<void> {
    await this.ready;

    await this.options.client.delete(this.options.collectionName, {
      wait: true,
      filter: buildFilter(filter),
    });
  }
}