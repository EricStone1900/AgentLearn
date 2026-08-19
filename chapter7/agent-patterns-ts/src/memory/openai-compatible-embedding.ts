import type { EmbeddingClient } from "./embedding.js";

export interface EmbeddingCreateRequest {
  model: string;
  input: string[];
  dimensions?: number;
  encoding_format: "float";
}

export interface EmbeddingCreateResponse {
  data: Array<{
    index: number;
    embedding: number[];
  }>;
}

export interface EmbeddingsApiClient {
  embeddings: {
    create(
      request: EmbeddingCreateRequest,
    ): Promise<EmbeddingCreateResponse>;
  };
}

export interface OpenAiCompatibleEmbeddingClientOptions {
  client: EmbeddingsApiClient;
  model: string;
  dimension: number;
  sendDimensions?: boolean;
  batchSize?: number;
}

export class OpenAiCompatibleEmbeddingClient implements EmbeddingClient {
  public readonly dimension: number;
  private readonly client: EmbeddingsApiClient;
  private readonly model: string;
  private readonly batchSize: number;
  private readonly sendDimensions: boolean;

  public constructor(options: OpenAiCompatibleEmbeddingClientOptions) {
    this.client = options.client;
    this.model = options.model.trim();
    this.dimension = options.dimension;
    this.batchSize = options.batchSize ?? 100;
    this.sendDimensions = options.sendDimensions ?? true;

    if (!this.model) {
      throw new Error("Embedding model 不能为空");
    }
    if (!Number.isInteger(this.dimension) || this.dimension <= 0) {
      throw new Error("Embedding dimension 必须是正整数");
    }
    if (!Number.isInteger(this.batchSize) || this.batchSize <= 0) {
      throw new Error("Embedding batchSize 必须是正整数");
    }
  }

  public async embed(text: string): Promise<number[]> {
    const normalized = text.trim();
    if (!normalized) throw new Error("Embedding 文本不能为空");

    const vectors = await this.embedBatch([normalized]);
    const vector = vectors[0];
    if (!vector) throw new Error("Embedding API 没有返回向量");
    return vector;
  }

  public async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const normalized = texts.map((text) => text.trim());
    if (normalized.some((text) => text.length === 0)) {
      throw new Error("Embedding 文本不能为空");
    }

    const vectors: number[][] = [];

    for (let start = 0; start < normalized.length; start += this.batchSize) {
      const batch = normalized.slice(start, start + this.batchSize);
      const response = await this.client.embeddings.create({
        model: this.model,
        input: batch,
        encoding_format: "float",
        ...(this.sendDimensions
          ? { dimensions: this.dimension }
          : {}),
      });

      const ordered = [...response.data].sort(
        (left, right) => left.index - right.index,
      );

      if (ordered.length !== batch.length) {
        throw new Error(
          `Embedding 数量不匹配：期望 ${batch.length}，实际 ${ordered.length}`,
        );
      }

      for (const item of ordered) {
        if (item.embedding.length !== this.dimension) {
          throw new Error(
            `Embedding 维度不匹配：期望 ${this.dimension}，实际 ${item.embedding.length}`,
          );
        }
        vectors.push(item.embedding);
      }
    }

    return vectors;
  }
}