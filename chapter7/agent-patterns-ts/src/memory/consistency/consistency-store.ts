import type { VectorRecord } from "../storage/vector-store.js";

/**
 * 扫描器只依赖它真正需要的 Qdrant 能力。
 * 这样 VectorStore 的在线检索接口不需要知道维护任务。
 */
export interface ConsistencyVectorStore {
  listMemoryIds(userId?: string): Promise<string[]>;
  upsert(records: VectorRecord[]): Promise<void>;
  delete(ids: string[]): Promise<void>;
}

/** Neo4j 维护任务需要的最小接口。 */
export interface ConsistencyGraphStore {
  listMemoryIds(userId?: string): Promise<string[]>;
  deleteByMemoryId(memoryId: string): Promise<void>;
}
