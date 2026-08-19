import { z } from "zod";
import type { MemorySearchOptions } from "../base.js";
import type { EmbeddingClient } from "../embedding.js";
import { importanceWeight, recencyScore } from "../scoring.js";
import type { MemoryItem, MemorySearchResult } from "../schemas.js";
import type { DocumentStore } from "../storage/document-store.js";
import type { VectorStore } from "../storage/vector-store.js";
import { StoredMemory } from "./stored-memory.js";

export const modalitySchema = z.enum(["text", "image", "audio", "video"]);
export type Modality = z.infer<typeof modalitySchema>;

export interface PerceptualSearchOptions extends MemorySearchOptions {
  targetModality?: Modality;
}

// Perceptual Memory 感知记忆
// 图像声音等
export class PerceptualMemory extends StoredMemory {
  public readonly type = "perceptual" as const;

  public constructor(
    documents: DocumentStore,
    vectors: VectorStore,
    embeddings: EmbeddingClient,
    private readonly now: () => Date = () => new Date(),
  ) {
    super(documents, vectors, embeddings);
  }

  public async add(item: MemoryItem): Promise<string> {
    modalitySchema.parse(item.metadata.modality);
    return this.storeItem(item);
  }

  public async retrieve(
    query: string,
    options: PerceptualSearchOptions = {},
  ): Promise<MemorySearchResult[]> {
    if (!query.trim()) throw new Error("感知记忆查询不能为空");

    const limit = options.limit ?? 5;
    const hits = await this.searchVectorCandidates(
      query,
      options,
      options.targetModality,
    );
    const results: MemorySearchResult[] = [];

    for (const hit of hits) {
      const item = await this.documents.get(hit.id);
      if (!item || item.memoryType !== this.type) continue;
      if (!this.matchesOptions(item, options)) continue;
      if (
        options.targetModality &&
        item.metadata.modality !== options.targetModality
      ) {
        continue;
      }

      const recency = recencyScore(item.timestamp, this.now());
      const relevance = hit.score * 0.8 + recency * 0.2;
      const score = relevance * importanceWeight(item.importance);

      results.push({
        item,
        score,
        signals: {
          relevance,
          vector: hit.score,
          recency,
          importance: item.importance,
        },
      });
    }

    return results.sort((left, right) => right.score - left.score).slice(0, limit);
  }

  public async getByModality(
    userId: string,
    modality: Modality,
    limit = 10,
  ): Promise<MemoryItem[]> {
    modalitySchema.parse(modality);
    const items = await this.getAll(userId);
    return items
      .filter((item) => item.metadata.modality === modality)
      .slice(0, limit);
  }
}