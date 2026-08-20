import type {
  MemoryOutboxOperation,
  SqliteMemoryOutbox,
} from "./sqlite-memory-outbox.js";
import type { MemoryConsistencyReport } from "./memory-consistency-types.js";

export interface EnqueueConsistencyResult {
  enqueuedTaskIds: string[];
  duplicateTaskCount: number;
}

export function enqueueConsistencyRepairs(
  report: MemoryConsistencyReport,
  outbox: SqliteMemoryOutbox,
): EnqueueConsistencyResult {
  const enqueuedTaskIds: string[] = [];
  let duplicateTaskCount = 0;

  const enqueue = (
    memoryId: string,
    operation: MemoryOutboxOperation,
  ): void => {
    const id = outbox.enqueue(memoryId, operation);
    if (id) enqueuedTaskIds.push(id);
    else duplicateTaskCount += 1;
  };

  for (const id of report.missingVectorIds) enqueue(id, "UPSERT_VECTOR");
  for (const id of report.orphanVectorIds) enqueue(id, "DELETE_VECTOR");
  for (const id of report.orphanGraphMemoryIds) enqueue(id, "DELETE_GRAPH");

  return { enqueuedTaskIds, duplicateTaskCount };
}
