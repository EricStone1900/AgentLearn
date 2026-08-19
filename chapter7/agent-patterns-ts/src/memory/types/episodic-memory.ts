import type { MemorySearchOptions } from "../base.js";
import type { EmbeddingClient } from "../embedding.js";
import {
  importanceWeight,
  recencyScore,
} from "../scoring.js";
import type {
  MemoryItem,
  MemorySearchResult,
} from "../schemas.js";
import type { DocumentStore } from "../storage/document-store.js";
import type { VectorStore } from "../storage/vector-store.js";
import { StoredMemory } from "./stored-memory.js";

// Episodic Memory 情景记忆
// 存储个人经历、事件、感受等与特定时间、地点相关的记忆
export class EpisodicMemory extends StoredMemory {
  public readonly type = "episodic" as const;

  public constructor(
    documents: DocumentStore,
    vectors: VectorStore,
    embeddings: EmbeddingClient,
    private readonly now: () => Date = () => new Date(),
  ) {
    super(documents, vectors, embeddings);
  }

  public async add(item: MemoryItem): Promise<string> {
    return this.storeItem(item);
  }

  public async retrieve(
    query: string,
    options: MemorySearchOptions = {},
  ): Promise<MemorySearchResult[]> {
    if (!query.trim()) throw new Error("情景记忆查询不能为空");

    const limit = options.limit ?? 5;
    const hits = await this.searchVectorCandidates(query, options);
    const results: MemorySearchResult[] = [];

    for (const hit of hits) {
      const item = await this.documents.get(hit.id);
      if (!item || item.memoryType !== this.type) continue;
      if (!this.matchesOptions(item, options)) continue;

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

  public async getTimeline(
    userId: string,
    limit = 50,
  ): Promise<MemoryItem[]> {
    const items = await this.documents.list({
      userId,
      memoryType: this.type,
    });

    return items
      .sort((left, right) => right.timestamp.localeCompare(left.timestamp))
      .slice(0, limit);
  }

  public async getSessionEpisodes(
    userId: string,
    sessionId: string,
  ): Promise<MemoryItem[]> {
    const items = await this.documents.list({
      userId,
      memoryType: this.type,
    });

    return items
      .filter((item) => item.metadata.sessionId === sessionId)
      .sort((left, right) => left.timestamp.localeCompare(right.timestamp));
  }
}