import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";

const operations = ["UPSERT_VECTOR", "DELETE_VECTOR", "DELETE_GRAPH"] as const;

const statuses = [
  "PENDING",
  "PROCESSING",
  "COMPLETED",
  "FAILED",
  "DEAD_LETTER",
] as const;

export type MemoryOutboxOperation = (typeof operations)[number];
export type MemoryOutboxStatus = (typeof statuses)[number];

export interface MemoryOutboxTask {
  id: string;
  memoryId: string;
  operation: MemoryOutboxOperation;
  payload: Record<string, unknown>;
  status: MemoryOutboxStatus;
  attempts: number;
  createdAt: string;
  lastError?: string;
}

interface OutboxRow {
  id: string;
  memory_id: string;
  operation: string;
  payload_json: string;
  status: string;
  attempts: number;
  created_at: string;
  last_error: string | null;
}

function includesValue<T extends string>(
  values: readonly T[],
  value: string,
): value is T {
  return values.includes(value as T);
}

function rowToTask(row: OutboxRow): MemoryOutboxTask {
  if (!includesValue(operations, row.operation)) {
    throw new Error(`Outbox ${row.id} 的 operation 不合法：${row.operation}`);
  }
  if (!includesValue(statuses, row.status)) {
    throw new Error(`Outbox ${row.id} 的 status 不合法：${row.status}`);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(row.payload_json);
  } catch {
    throw new Error(`Outbox ${row.id} 的 payload_json 不是合法 JSON`);
  }

  if (
    typeof payload !== "object" ||
    payload === null ||
    Array.isArray(payload)
  ) {
    throw new Error(`Outbox ${row.id} 的 payload_json 必须是 JSON 对象`);
  }

  return {
    id: row.id,
    memoryId: row.memory_id,
    operation: row.operation,
    payload: payload as Record<string, unknown>,
    status: row.status,
    attempts: row.attempts,
    createdAt: row.created_at,
    ...(row.last_error ? { lastError: row.last_error } : {}),
  };
}

export class SqliteMemoryOutbox {
  public constructor(
    private readonly database: Database.Database,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.migrate();
  }

  private migrate(): void {
    this.database.exec(
      [
        "CREATE TABLE IF NOT EXISTS memory_outbox (",
        "  id TEXT PRIMARY KEY,",
        "  memory_id TEXT NOT NULL,",
        "  operation TEXT NOT NULL CHECK (operation IN (",
        "    'UPSERT_VECTOR', 'DELETE_VECTOR', 'DELETE_GRAPH'",
        "  )),",
        "  payload_json TEXT NOT NULL,",
        "  status TEXT NOT NULL CHECK (status IN (",
        "    'PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'DEAD_LETTER'",
        "  )),",
        "  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),",
        "  created_at TEXT NOT NULL,",
        "  last_error TEXT",
        ");",
        "CREATE INDEX IF NOT EXISTS idx_memory_outbox_status_created",
        "  ON memory_outbox(status, created_at);",
        "CREATE INDEX IF NOT EXISTS idx_memory_outbox_memory_operation",
        "  ON memory_outbox(memory_id, operation);",
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_memory_outbox_unresolved",
        "  ON memory_outbox(memory_id, operation)",
        "  WHERE status IN (",
        "    'PENDING', 'PROCESSING', 'FAILED', 'DEAD_LETTER'",
        "  );",
      ].join("\n"),
    );
  }

  /** 同一个未完成修复只保留一条任务，防止重复扫描不断堆积。 */
  public enqueue(
    memoryId: string,
    operation: MemoryOutboxOperation,
    payload: Record<string, unknown> = {},
  ): string | undefined {
    if (memoryId.trim().length === 0) {
      throw new Error("Outbox memoryId 不能为空");
    }

    const id = randomUUID();
    const result = this.database
      .prepare(
        [
          "INSERT INTO memory_outbox (",
          "  id, memory_id, operation, payload_json, status, created_at",
          ")",
          "SELECT @id, @memoryId, @operation, @payloadJson, 'PENDING', @createdAt",
          "WHERE NOT EXISTS (",
          "  SELECT 1 FROM memory_outbox",
          "  WHERE memory_id = @memoryId",
          "    AND operation = @operation",
          "    AND status IN (",
          "      'PENDING', 'PROCESSING', 'FAILED', 'DEAD_LETTER'",
          "    )",
          ")",
        ].join("\n"),
      )
      .run({
        id,
        memoryId,
        operation,
        payloadJson: JSON.stringify(payload),
        createdAt: this.now().toISOString(),
      });

    return result.changes > 0 ? id : undefined;
  }

  /**
   * 当前教程限定单 worker。事务保证读取和改成 PROCESSING 同时完成。
   */
  public claimNext(maxAttempts: number): MemoryOutboxTask | undefined {
    if (!Number.isInteger(maxAttempts) || maxAttempts <= 0) {
      throw new Error("maxAttempts 必须是正整数");
    }

    const claim = this.database.transaction(() => {
      const row = this.database
        .prepare(
          [
            "SELECT * FROM memory_outbox",
            "WHERE status IN ('PENDING', 'FAILED')",
            "  AND attempts < ?",
            "ORDER BY created_at ASC",
            "LIMIT 1",
          ].join("\n"),
        )
        .get(maxAttempts) as OutboxRow | undefined;

      if (!row) return undefined;

      this.database
        .prepare(
          [
            "UPDATE memory_outbox",
            "SET status = 'PROCESSING', attempts = attempts + 1, last_error = NULL",
            "WHERE id = ?",
          ].join("\n"),
        )
        .run(row.id);

      return rowToTask({
        ...row,
        status: "PROCESSING",
        attempts: row.attempts + 1,
        last_error: null,
      });
    });

    return claim();
  }

  public complete(id: string): void {
    const result = this.database
      .prepare(
        [
          "UPDATE memory_outbox",
          "SET status = 'COMPLETED', last_error = NULL",
          "WHERE id = ? AND status = 'PROCESSING'",
        ].join("\n"),
      )
      .run(id);

    if (result.changes !== 1) {
      throw new Error(`Outbox 任务无法完成：${id}`);
    }
  }

  public fail(id: string, message: string, deadLetter: boolean): void {
    const result = this.database
      .prepare(
        [
          "UPDATE memory_outbox",
          "SET status = ?, last_error = ?",
          "WHERE id = ? AND status = 'PROCESSING'",
        ].join("\n"),
      )
      .run(deadLetter ? "DEAD_LETTER" : "FAILED", message, id);

    if (result.changes !== 1) {
      throw new Error(`Outbox 任务无法标记失败：${id}`);
    }
  }

  /**
   * 单 worker 进程重启时恢复中断任务。
   * 已经耗尽尝试次数的任务直接进入死信，避免永远停留在 FAILED。
   */
  public recoverInterrupted(maxAttempts: number): void {
    if (!Number.isInteger(maxAttempts) || maxAttempts <= 0) {
      throw new Error("maxAttempts 必须是正整数");
    }

    this.database
      .prepare(
        [
          "UPDATE memory_outbox",
          "SET status = CASE",
          "      WHEN attempts >= @maxAttempts THEN 'DEAD_LETTER'",
          "      ELSE 'FAILED'",
          "    END,",
          "    last_error = 'worker interrupted'",
          "WHERE status = 'PROCESSING'",
        ].join("\n"),
      )
      .run({ maxAttempts });
  }

  public get(id: string): MemoryOutboxTask | undefined {
    const row = this.database
      .prepare("SELECT * FROM memory_outbox WHERE id = ?")
      .get(id) as OutboxRow | undefined;

    return row ? rowToTask(row) : undefined;
  }

  public list(): MemoryOutboxTask[] {
    const rows = this.database
      .prepare("SELECT * FROM memory_outbox ORDER BY created_at ASC, id ASC")
      .all() as OutboxRow[];

    return rows.map(rowToTask);
  }

  public countByStatus(status: MemoryOutboxStatus): number {
    const row = this.database
      .prepare(
        "SELECT count(*) AS count FROM memory_outbox WHERE status = ?",
      )
      .get(status) as { count: number };

    return row.count;
  }

  /** 人工确认外部服务恢复后，显式重新激活死信任务。 */
  public requeueDeadLetter(id: string): void {
    const result = this.database
      .prepare(
        [
          "UPDATE memory_outbox",
          "SET status = 'PENDING', attempts = 0, last_error = NULL",
          "WHERE id = ? AND status = 'DEAD_LETTER'",
        ].join("\n"),
      )
      .run(id);

    if (result.changes !== 1) {
      throw new Error(`Outbox 死信任务无法重新入队：${id}`);
    }
  }
}
