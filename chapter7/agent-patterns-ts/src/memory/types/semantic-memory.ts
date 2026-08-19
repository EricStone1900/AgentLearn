import type { MemorySearchOptions } from "../base.js";
import type { EmbeddingClient } from "../embedding.js";
import type { KnowledgeExtractor } from "../knowledge-extractor.js";
import { importanceWeight } from "../scoring.js";
import type { MemoryItem, MemorySearchResult } from "../schemas.js";
import type { DocumentStore } from "../storage/document-store.js";
import type { GraphStore } from "../storage/graph-store.js";
import type { VectorStore } from "../storage/vector-store.js";
import { StoredMemory } from "./stored-memory.js";

// 语义记忆 Semantic Memory：存储通用事实、概念、常识、规则，不绑定具体时间、场景抖音百科。
// ✅ 存：知识、定义、客观事实、用户长期偏好、业务规则
// ❌ 不存：某一次发生的具体事件（那是 Episodic Memory 情景记忆）

export class SemanticMemory extends StoredMemory {
  public readonly type = "semantic" as const;

  public constructor(
    documents: DocumentStore,
    vectors: VectorStore,
    embeddings: EmbeddingClient,
    private readonly graph: GraphStore,
    private readonly extractor: KnowledgeExtractor,
  ) {
    super(documents, vectors, embeddings);
  }

  public async add(item: MemoryItem): Promise<string> {
    if (item.memoryType !== this.type) {
      throw new Error(`SemanticMemory 不能保存 ${item.memoryType} 记忆`);
    }

    const knowledge = await this.extractor.extract(item.content, {
      memoryId: item.id,
      userId: item.userId,
    });

    const enriched: MemoryItem = {
      ...item,
      metadata: {
        ...item.metadata,
        entityIds: knowledge.entities.map((entity) => entity.id),
      },
    };

    await this.storeItem(enriched);

    try {
      for (const entity of knowledge.entities) await this.graph.addEntity(entity);
      for (const relation of knowledge.relations) await this.graph.addRelation(relation);
    } catch (error: unknown) {
      await super.remove(item.id);
      await this.graph.deleteByMemoryId(item.id);
      throw error;
    }

    return item.id;
  }

  public async retrieve(
    query: string,
    options: MemorySearchOptions = {},
  ): Promise<MemorySearchResult[]> {
    if (!query.trim()) throw new Error("语义记忆查询不能为空");

    const userId = options.userId;
    if (!userId) throw new Error("语义图检索必须指定 userId");

    const limit = options.limit ?? 5;
    const vectorHits = await this.searchVectorCandidates(query, options);
    const queryKnowledge = await this.extractor.extract(query, {
      memoryId: "query",
      userId,
    });
    const graphHits = await this.graph.findRelatedMemories(
      queryKnowledge.entities,
      userId,
      2,
    );

    const vectorScores = new Map(vectorHits.map((hit) => [hit.id, hit.score]));
    const graphScores = new Map(
      graphHits.map((hit) => [hit.memoryId, hit.score]),
    );
    const ids = new Set([...vectorScores.keys(), ...graphScores.keys()]);
    const results: MemorySearchResult[] = [];

    for (const id of ids) {
      const item = await this.documents.get(id);
      if (!item || item.memoryType !== this.type) continue;
      if (!this.matchesOptions(item, options)) continue;

      const vector = vectorScores.get(id) ?? 0;
      const graph = graphScores.get(id) ?? 0;
      const relevance = vector * 0.7 + graph * 0.3;
      const score = relevance * importanceWeight(item.importance);

      results.push({
        item,
        score,
        signals: {
          relevance,
          vector,
          graph,
          importance: item.importance,
        },
      });
    }

    return results.sort((left, right) => right.score - left.score).slice(0, limit);
  }

  public override async remove(memoryId: string): Promise<boolean> {
    const removed = await super.remove(memoryId);
    if (removed) await this.graph.deleteByMemoryId(memoryId);
    return removed;
  }

  public override async clear(userId?: string): Promise<void> {
    const items = await this.getAll(userId);
    await super.clear(userId);
    for (const item of items) await this.graph.deleteByMemoryId(item.id);
  }
}