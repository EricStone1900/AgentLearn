import type { EmbeddingClient } from "../embedding.js";
import { createMemoryVectorRecord } from "../memory-vector-record.js";
import type { DocumentStore } from "../storage/document-store.js";
import type {
  ConsistencyGraphStore,
  ConsistencyVectorStore,
} from "./consistency-store.js";
import type { SqliteMemoryOutbox } from "./sqlite-memory-outbox.js";

export interface MemoryOutboxRunResult {
  completed: number;
  failed: number;
  deadLettered: number;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class MemoryOutboxWorker {
  public constructor(
    private readonly outbox: SqliteMemoryOutbox,
    private readonly documents: DocumentStore,
    private readonly vectors: ConsistencyVectorStore,
    private readonly graph: ConsistencyGraphStore,
    private readonly embeddings: EmbeddingClient,
    private readonly maxAttempts = 5,
  ) {
    if (!Number.isInteger(maxAttempts) || maxAttempts <= 0) {
      throw new Error("maxAttempts 必须是正整数");
    }
  }

  public async runUntilEmpty(): Promise<MemoryOutboxRunResult> {
    let completed = 0;
    let failed = 0;
    let deadLettered = 0;

    while (true) {
      const task = this.outbox.claimNext(this.maxAttempts);
      if (!task) break;

      try {
        switch (task.operation) {
          case "UPSERT_VECTOR": {
            const item = await this.documents.get(task.memoryId);

            /* 文档已被正常删除，原来的“缺向量”问题已经消失。 */
            if (item) {
              const vector = await this.embeddings.embed(item.content);
              await this.vectors.upsert([
                createMemoryVectorRecord(item, vector),
              ]);
            }
            break;
          }
          case "DELETE_VECTOR": {
            /* 任务可能排队很久；执行前重新检查权威来源。 */
            const item = await this.documents.get(task.memoryId);
            if (!item) await this.vectors.delete([task.memoryId]);
            break;
          }
          case "DELETE_GRAPH": {
            const item = await this.documents.get(task.memoryId);
            if (!item) await this.graph.deleteByMemoryId(task.memoryId);
            break;
          }
        }

        this.outbox.complete(task.id);
        completed += 1;
      } catch (error: unknown) {
        const deadLetter = task.attempts >= this.maxAttempts;
        this.outbox.fail(task.id, errorMessage(error), deadLetter);
        failed += 1;
        if (deadLetter) deadLettered += 1;

        /*
         * 本轮不立即再次领取同一 FAILED 任务，避免外部服务故障时热循环。
         * 由下一次定时运行继续重试。
         */
        break;
      }
    }

    return { completed, failed, deadLettered };
  }
}
