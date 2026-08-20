import type { MemoryItem } from "./schemas.js";
import type { VectorRecord } from "./storage/vector-store.js";

export function createMemoryVectorRecord(
  item: MemoryItem,
  vector: number[],
): VectorRecord {
  return {
    id: item.id,
    vector,
    metadata: {
      ...item.metadata,
      memoryId: item.id,
      userId: item.userId,
      memoryType: item.memoryType,
      importance: item.importance,
    },
  };
}
