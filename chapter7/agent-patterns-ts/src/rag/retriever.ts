import type { LlmClient } from "../core/types.js";
import type { EmbeddingClient } from "../memory/embedding.js";
import type { RagSearchOptions, RagSearchResult } from "./schemas.js";
import type { RagDocumentStore } from "./storage/rag-document-store.js";
import type { RagVectorStore } from "./storage/rag-vector-store.js";

export interface AdvancedSearchOptions extends RagSearchOptions {
  enableMqe?: boolean;
  mqeExpansions?: number;
  enableHyde?: boolean;
  candidatePoolMultiplier?: number;
}

export class RagRetriever {
  public constructor(
    private readonly documents: RagDocumentStore,
    private readonly vectors: RagVectorStore,
    private readonly embeddings: EmbeddingClient,
    private readonly llm?: LlmClient,
  ) {}

  public async search(query: string, options: RagSearchOptions): Promise<RagSearchResult[]> {
    const normalized = query.trim();
    if (!normalized) throw new Error("RAG 查询不能为空");
    const limit = options.limit ?? 5;
    const vector = await this.embeddings.embed(normalized);
    const hits = await this.vectors.search(vector, {
      namespace: options.namespace,
      limit,
      ...(options.minScore === undefined ? {} : { minScore: options.minScore }),
      ...(options.documentId ? { documentId: options.documentId } : {}),
    });
    return this.hydrate(options.namespace, hits);
  }

  public async searchAdvanced(
    query: string,
    options: AdvancedSearchOptions,
  ): Promise<RagSearchResult[]> {
    if (!options.enableMqe && !options.enableHyde) return this.search(query, options);
    if (!this.llm) throw new Error("高级 RAG 检索需要 LlmClient");

    const normalizedQuery = query.trim();
    if (!normalizedQuery) throw new Error("RAG 查询不能为空");

    const expansions = [normalizedQuery];
    if (options.enableMqe) {
      try {
        expansions.push(...await this.expandQueries(
          normalizedQuery,
          options.mqeExpansions ?? 2,
        ));
      } catch {
        // 查询扩展失败时仍使用原始查询，避免高级检索整体不可用。
      }
    }
    if (options.enableHyde) {
      try {
        expansions.push(await this.createHydeDocument(normalizedQuery));
      } catch {
        // HyDE 失败时退回原始查询和已经成功生成的 MQE 查询。
      }
    }
    const unique = [...new Set(expansions.map((item) => item.trim()).filter(Boolean))];
    const limit = options.limit ?? 5;
    const pool = Math.max(limit * (options.candidatePoolMultiplier ?? 4), 20);
    const perQuery = Math.max(1, Math.ceil(pool / unique.length));

    const groups = await Promise.all(unique.map(async (expandedQuery) => {
      const vector = await this.embeddings.embed(expandedQuery);
      return this.vectors.search(vector, {
        namespace: options.namespace,
        limit: perQuery,
        ...(options.minScore === undefined ? {} : { minScore: options.minScore }),
        ...(options.documentId ? { documentId: options.documentId } : {}),
      });
    }));

    const best = new Map<string, { chunkId: string; score: number }>();
    for (const hit of groups.flat()) {
      const previous = best.get(hit.chunkId);
      if (!previous || hit.score > previous.score) best.set(hit.chunkId, hit);
    }
    const merged = [...best.values()].sort((a, b) => b.score - a.score).slice(0, limit);
    return this.hydrate(options.namespace, merged);
  }

  private async hydrate(
    namespace: string,
    hits: Array<{ chunkId: string; score: number }>,
  ): Promise<RagSearchResult[]> {
    const chunks = await this.documents.getChunksByIds(
      namespace,
      hits.map((hit) => hit.chunkId),
    );
    const chunksById = new Map(chunks.map((chunk) => [chunk.id, chunk]));
    const documentIds = [...new Set(chunks.map((chunk) => chunk.documentId))];
    const documentPairs = await Promise.all(documentIds.map(async (id) => {
      return [id, await this.documents.getDocument(namespace, id)] as const;
    }));
    const documentsById = new Map(documentPairs);

    return hits.flatMap((hit) => {
      const chunk = chunksById.get(hit.chunkId);
      const document = chunk ? documentsById.get(chunk.documentId) : undefined;
      return chunk?.namespace === namespace && document?.namespace === namespace
        ? [{ chunk, document, score: hit.score }]
        : [];
    });
  }

  private async expandQueries(query: string, count: number): Promise<string[]> {
    const output = await this.llm!.generate([
      {
        role: "system",
        content: "你是检索查询扩展助手。只输出语义等价或互补的查询，每行一个，不要编号。",
      },
      { role: "user", content: `原始查询：${query}\n生成 ${count} 个查询。` },
    ], 0);
    return output.split(/\r?\n/u)
      .map((line) => line.replace(/^[-*\d.、\s]+/u, "").trim())
      .filter(Boolean)
      .slice(0, count);
  }

  private async createHydeDocument(query: string): Promise<string> {
    return this.llm!.generate([
      {
        role: "system",
        content: "为问题写一段客观的假设答案，仅用于向量检索。不要解释过程。",
      },
      { role: "user", content: query },
    ], 0);
  }
}
