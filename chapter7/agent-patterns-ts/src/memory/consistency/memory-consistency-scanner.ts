import type { EmbeddingClient } from "../embedding.js";
import { createMemoryVectorRecord } from "../memory-vector-record.js";
import type { DocumentStore } from "../storage/document-store.js";
import type {
  ConsistencyGraphStore,
  ConsistencyVectorStore,
} from "./consistency-store.js";
import {
  MemoryConsistencyRepairError,
  type MemoryConsistencyRepairFailure,
  type MemoryConsistencyRepairResult,
  type MemoryConsistencyReport,
} from "./memory-consistency-types.js";

export interface MemoryConsistencyScanOptions {
  /** 不传表示扫描全部用户；生产环境推荐每次只扫描一个用户。 */
  userId?: string;
}

function difference(left: Set<string>, right: Set<string>): string[] {
  return [...left].filter((id) => !right.has(id)).sort();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class MemoryConsistencyScanner {
  public constructor(
    private readonly documents: DocumentStore,
    private readonly vectors: ConsistencyVectorStore,
    private readonly graph: ConsistencyGraphStore,
    private readonly embeddings: EmbeddingClient,
  ) {}

  /**
   * 只读操作：取得三个后端的 ID 快照并计算集合差集。
   */
  public async scan(
    options: MemoryConsistencyScanOptions = {},
  ): Promise<MemoryConsistencyReport> {
    const [documents, vectorIds, graphMemoryIds] = await Promise.all([
      this.documents.list(options.userId ? { userId: options.userId } : {}),
      this.vectors.listMemoryIds(options.userId),
      this.graph.listMemoryIds(options.userId),
    ]);

    const documentIds = new Set(documents.map((item) => item.id));
    const vectorIdSet = new Set(vectorIds);
    const graphMemoryIdSet = new Set(graphMemoryIds);

    return {
      missingVectorIds: difference(documentIds, vectorIdSet),
      orphanVectorIds: difference(vectorIdSet, documentIds),
      orphanGraphMemoryIds: difference(graphMemoryIdSet, documentIds),
    };
  }

  /**
   * 基础版直接修复。每个 ID 独立处理，一个失败不会阻止其他 ID 被尝试。
   * 所有操作结束后会重新扫描；只要出现异常，就抛出 RepairError。
   */
  public async scanAndRepair(
    options: MemoryConsistencyScanOptions = {},
  ): Promise<MemoryConsistencyRepairResult> {
    const before = await this.scan(options);
    const repairedVectorIds: string[] = [];
    const deletedVectorIds: string[] = [];
    const deletedGraphMemoryIds: string[] = [];
    const failures: MemoryConsistencyRepairFailure[] = [];

    for (const memoryId of before.missingVectorIds) {
      try {
        /* 文档可能在 scan() 后被删除，所以修复前必须重新读取。 */
        const item = await this.documents.get(memoryId);
        if (!item) continue;

        const vector = await this.embeddings.embed(item.content);
        await this.vectors.upsert([createMemoryVectorRecord(item, vector)]);
        repairedVectorIds.push(memoryId);
      } catch (error: unknown) {
        failures.push({
          memoryId,
          operation: "UPSERT_VECTOR",
          message: errorMessage(error),
        });
      }
    }

    for (const memoryId of before.orphanVectorIds) {
      try {
        /* scan() 后若同 ID 文档已创建，就不能再把它的向量删掉。 */
        if (await this.documents.get(memoryId)) continue;

        /* delete 必须是幂等操作；point 已不存在也应该视为成功。 */
        await this.vectors.delete([memoryId]);
        deletedVectorIds.push(memoryId);
      } catch (error: unknown) {
        failures.push({
          memoryId,
          operation: "DELETE_VECTOR",
          message: errorMessage(error),
        });
      }
    }

    for (const memoryId of before.orphanGraphMemoryIds) {
      try {
        /* 重新检查 SQLite 权威状态，避免删除刚刚恢复为有效的关系。 */
        if (await this.documents.get(memoryId)) continue;

        await this.graph.deleteByMemoryId(memoryId);
        deletedGraphMemoryIds.push(memoryId);
      } catch (error: unknown) {
        failures.push({
          memoryId,
          operation: "DELETE_GRAPH",
          message: errorMessage(error),
        });
      }
    }

    const after = await this.scan(options);
    const result: MemoryConsistencyRepairResult = {
      before,
      repairedVectorIds,
      deletedVectorIds,
      deletedGraphMemoryIds,
      failures,
      after,
    };

    const hasRemainingInconsistency =
      after.missingVectorIds.length > 0 ||
      after.orphanVectorIds.length > 0 ||
      after.orphanGraphMemoryIds.length > 0;

    if (failures.length > 0 || hasRemainingInconsistency) {
      throw new MemoryConsistencyRepairError(result);
    }

    return result;
  }
}
