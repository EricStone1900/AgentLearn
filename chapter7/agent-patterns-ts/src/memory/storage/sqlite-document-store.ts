import Database from "better-sqlite3";
import { memoryItemSchema } from "../schemas.js";
import type { MemoryItem } from "../schemas.js";
import type { DocumentFilter, DocumentStore } from "./document-store.js";

interface MemoryRow {
  id: string;
  content: string;
  memory_type: string;
  user_id: string;
  timestamp: string;
  importance: number;
  metadata_json: string;
}

type SqlParameter = string | number;

function rowToMemoryItem(row: MemoryRow): MemoryItem {
  let metadata: unknown;

  try {
    metadata = JSON.parse(row.metadata_json);
  } catch {
    throw new Error(`记忆 ${row.id} 的 metadata_json 不是合法 JSON`);
  }

  return memoryItemSchema.parse({
    id: row.id,
    content: row.content,
    memoryType: row.memory_type,
    userId: row.user_id,
    timestamp: row.timestamp,
    importance: row.importance,
    metadata,
  });
}

function buildWhere(filter: DocumentFilter): {
  clause: string;
  parameters: Record<string, SqlParameter>;
} {
  const conditions: string[] = [];
  const parameters: Record<string, SqlParameter> = {};

  if (filter.userId) {
    conditions.push("user_id = @userId");
    parameters.userId = filter.userId;
  }
  if (filter.memoryType) {
    conditions.push("memory_type = @memoryType");
    parameters.memoryType = filter.memoryType;
  }
  if (filter.minImportance !== undefined) {
    conditions.push("importance >= @minImportance");
    parameters.minImportance = filter.minImportance;
  }
  if (filter.startTime) {
    conditions.push("timestamp >= @startTime");
    parameters.startTime = filter.startTime;
  }
  if (filter.endTime) {
    conditions.push("timestamp <= @endTime");
    parameters.endTime = filter.endTime;
  }

  return {
    clause: conditions.length === 0 ? "" : ` WHERE ${conditions.join(" AND ")}`,
    parameters,
  };
}

export class SqliteDocumentStore implements DocumentStore {
  public constructor(private readonly database: Database.Database) {
    this.database.pragma("journal_mode = WAL");
    this.database.pragma("foreign_keys = ON");
    this.migrate();
  }

  private migrate(): void {
    this.database.exec(
      [
        "CREATE TABLE IF NOT EXISTS memories (",
        "  id TEXT PRIMARY KEY,",
        "  content TEXT NOT NULL,",
        "  memory_type TEXT NOT NULL,",
        "  user_id TEXT NOT NULL,",
        "  timestamp TEXT NOT NULL,",
        "  importance REAL NOT NULL CHECK (importance >= 0 AND importance <= 1),",
        "  metadata_json TEXT NOT NULL",
        ");",
        "CREATE INDEX IF NOT EXISTS idx_memories_user_type",
        "  ON memories(user_id, memory_type);",
        "CREATE INDEX IF NOT EXISTS idx_memories_user_timestamp",
        "  ON memories(user_id, timestamp DESC);",
        "CREATE INDEX IF NOT EXISTS idx_memories_user_importance",
        "  ON memories(user_id, importance DESC);",
      ].join("\n"),
    );
  }

  public async add(item: MemoryItem): Promise<void> {
    const parsed = memoryItemSchema.parse(item);

    this.database
      .prepare(
        [
          "INSERT INTO memories (",
          "  id, content, memory_type, user_id,",
          "  timestamp, importance, metadata_json",
          ") VALUES (",
          "  @id, @content, @memoryType, @userId,",
          "  @timestamp, @importance, @metadataJson",
          ")",
        ].join("\n"),
      )
      .run({
        id: parsed.id,
        content: parsed.content,
        memoryType: parsed.memoryType,
        userId: parsed.userId,
        timestamp: parsed.timestamp,
        importance: parsed.importance,
        metadataJson: JSON.stringify(parsed.metadata),
      });
  }

  public async get(memoryId: string): Promise<MemoryItem | undefined> {
    const row = this.database
      .prepare("SELECT * FROM memories WHERE id = ?")
      .get(memoryId) as MemoryRow | undefined;

    return row ? rowToMemoryItem(row) : undefined;
  }

  public async list(filter: DocumentFilter = {}): Promise<MemoryItem[]> {
    const where = buildWhere(filter);
    const rows = this.database
      .prepare(
        [
          "SELECT * FROM memories",
          where.clause,
          " ORDER BY timestamp DESC",
        ].join(""),
      )
      .all(where.parameters) as MemoryRow[];

    return rows.map(rowToMemoryItem);
  }

  public async update(item: MemoryItem): Promise<void> {
    const parsed = memoryItemSchema.parse(item);
    const result = this.database
      .prepare(
        [
          "UPDATE memories SET",
          " content = @content,",
          " memory_type = @memoryType,",
          " user_id = @userId,",
          " timestamp = @timestamp,",
          " importance = @importance,",
          " metadata_json = @metadataJson",
          " WHERE id = @id",
        ].join(""),
      )
      .run({
        id: parsed.id,
        content: parsed.content,
        memoryType: parsed.memoryType,
        userId: parsed.userId,
        timestamp: parsed.timestamp,
        importance: parsed.importance,
        metadataJson: JSON.stringify(parsed.metadata),
      });

    if (result.changes === 0) {
      throw new Error(`记忆不存在：${parsed.id}`);
    }
  }

  public async delete(memoryId: string): Promise<boolean> {
    const result = this.database
      .prepare("DELETE FROM memories WHERE id = ?")
      .run(memoryId);

    return result.changes > 0;
  }

  public async clear(filter: DocumentFilter = {}): Promise<void> {
    const where = buildWhere(filter);
    this.database
      .prepare(`DELETE FROM memories${where.clause}`)
      .run(where.parameters);
  }
}
