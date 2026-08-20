import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { SqliteMemoryOutbox } from "../src/memory/consistency/sqlite-memory-outbox.js";

function createSubject() {
  const database = new Database(":memory:");
  const now = () => new Date("2026-08-20T10:00:00.000Z");
  const outbox = new SqliteMemoryOutbox(database, now);
  return { database, outbox };
}

describe("SqliteMemoryOutbox", () => {
  it("迁移表、去重活动任务并允许已完成任务再次创建", () => {
    const { database, outbox } = createSubject();

    try {
      const firstId = outbox.enqueue("memory-1", "DELETE_VECTOR", {
        reason: "orphan",
      });
      const duplicateId = outbox.enqueue("memory-1", "DELETE_VECTOR");

      expect(firstId).toEqual(expect.any(String));
      expect(duplicateId).toBeUndefined();
      expect(outbox.list()).toHaveLength(1);
      expect(outbox.get(firstId!)).toMatchObject({
        id: firstId,
        memoryId: "memory-1",
        operation: "DELETE_VECTOR",
        payload: { reason: "orphan" },
        status: "PENDING",
        attempts: 0,
        createdAt: "2026-08-20T10:00:00.000Z",
      });

      const claimed = outbox.claimNext(3);
      expect(claimed).toMatchObject({
        id: firstId,
        status: "PROCESSING",
        attempts: 1,
      });

      outbox.complete(firstId!);
      expect(outbox.get(firstId!)?.status).toBe("COMPLETED");

      /* COMPLETED 已解决，因此未来再次漂移时允许创建新任务。 */
      const newId = outbox.enqueue("memory-1", "DELETE_VECTOR");
      expect(newId).toEqual(expect.any(String));
      expect(newId).not.toBe(firstId);
      expect(outbox.list()).toHaveLength(2);
    } finally {
      database.close();
    }
  });

  it("失败任务可重试，达到上限后进入死信", () => {
    const { database, outbox } = createSubject();

    try {
      const id = outbox.enqueue("memory-2", "DELETE_GRAPH");
      expect(id).toEqual(expect.any(String));

      const firstAttempt = outbox.claimNext(2);
      expect(firstAttempt?.attempts).toBe(1);
      outbox.fail(firstAttempt!.id, "Neo4j unavailable", false);

      expect(outbox.get(id!)).toMatchObject({
        status: "FAILED",
        attempts: 1,
        lastError: "Neo4j unavailable",
      });

      const secondAttempt = outbox.claimNext(2);
      expect(secondAttempt?.attempts).toBe(2);
      outbox.fail(secondAttempt!.id, "Neo4j unavailable", true);

      expect(outbox.get(id!)).toMatchObject({
        status: "DEAD_LETTER",
        attempts: 2,
        lastError: "Neo4j unavailable",
      });
      expect(outbox.countByStatus("DEAD_LETTER")).toBe(1);
      expect(outbox.claimNext(2)).toBeUndefined();

      /* 死信未人工处理前，扫描器不能绕过它创建重复任务。 */
      expect(outbox.enqueue("memory-2", "DELETE_GRAPH")).toBeUndefined();

      outbox.requeueDeadLetter(id!);
      expect(outbox.get(id!)).toMatchObject({
        status: "PENDING",
        attempts: 0,
      });
      expect(outbox.countByStatus("DEAD_LETTER")).toBe(0);
    } finally {
      database.close();
    }
  });

  it("恢复中断任务并把耗尽尝试次数的任务转入死信", () => {
    const { database, outbox } = createSubject();

    try {
      const id = outbox.enqueue("memory-3", "UPSERT_VECTOR");
      expect(outbox.claimNext(2)).toMatchObject({
        status: "PROCESSING",
        attempts: 1,
      });

      outbox.recoverInterrupted(2);

      expect(outbox.get(id!)).toMatchObject({
        status: "FAILED",
        attempts: 1,
        lastError: "worker interrupted",
      });

      expect(outbox.claimNext(2)).toMatchObject({
        status: "PROCESSING",
        attempts: 2,
      });

      outbox.recoverInterrupted(2);

      expect(outbox.get(id!)).toMatchObject({
        status: "DEAD_LETTER",
        attempts: 2,
        lastError: "worker interrupted",
      });
      expect(outbox.claimNext(2)).toBeUndefined();
    } finally {
      database.close();
    }
  });
});
