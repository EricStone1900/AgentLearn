import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { enqueueConsistencyRepairs } from "../src/memory/consistency/enqueue-consistency-repairs.js";
import { SqliteMemoryOutbox } from "../src/memory/consistency/sqlite-memory-outbox.js";

describe("enqueueConsistencyRepairs", () => {
  it("把三类不一致映射成三类 outbox 任务并去重", () => {
    const database = new Database(":memory:");
    const outbox = new SqliteMemoryOutbox(database);
    const report = {
      missingVectorIds: ["missing-vector"],
      orphanVectorIds: ["orphan-vector"],
      orphanGraphMemoryIds: ["orphan-graph"],
    };

    try {
      const first = enqueueConsistencyRepairs(report, outbox);

      expect(first.enqueuedTaskIds).toHaveLength(3);
      expect(first.duplicateTaskCount).toBe(0);
      expect(
        outbox
          .list()
          .map((task) => `${task.operation}:${task.memoryId}`)
          .sort(),
      ).toEqual([
        "DELETE_GRAPH:orphan-graph",
        "DELETE_VECTOR:orphan-vector",
        "UPSERT_VECTOR:missing-vector",
      ]);
      expect(outbox.list().every((task) => task.status === "PENDING")).toBe(
        true,
      );

      const second = enqueueConsistencyRepairs(report, outbox);

      expect(second.enqueuedTaskIds).toEqual([]);
      expect(second.duplicateTaskCount).toBe(3);
      expect(outbox.list()).toHaveLength(3);
    } finally {
      database.close();
    }
  });
});
