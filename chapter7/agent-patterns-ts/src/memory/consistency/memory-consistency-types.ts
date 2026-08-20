export interface MemoryConsistencyReport {
  /** SQLite 有文档，Qdrant 没有对应 point。 */
  missingVectorIds: string[];

  /** Qdrant 有 point，SQLite 没有对应文档。 */
  orphanVectorIds: string[];

  /** Neo4j 有关系，SQLite 没有对应文档。 */
  orphanGraphMemoryIds: string[];
}

export interface MemoryConsistencyRepairFailure {
  memoryId: string;
  operation: "UPSERT_VECTOR" | "DELETE_VECTOR" | "DELETE_GRAPH";
  message: string;
}

export interface MemoryConsistencyRepairResult {
  before: MemoryConsistencyReport;
  repairedVectorIds: string[];
  deletedVectorIds: string[];
  deletedGraphMemoryIds: string[];
  failures: MemoryConsistencyRepairFailure[];
  after: MemoryConsistencyReport;
}

function countInconsistencies(report: MemoryConsistencyReport): number {
  return (
    report.missingVectorIds.length +
    report.orphanVectorIds.length +
    report.orphanGraphMemoryIds.length
  );
}

export class MemoryConsistencyRepairError extends Error {
  public constructor(public readonly result: MemoryConsistencyRepairResult) {
    super(
      [
        "记忆一致性修复未完全成功：",
        `${result.failures.length} 个操作失败，`,
        `${countInconsistencies(result.after)} 个不一致仍然存在`,
      ].join(""),
    );
    this.name = "MemoryConsistencyRepairError";
  }
}
