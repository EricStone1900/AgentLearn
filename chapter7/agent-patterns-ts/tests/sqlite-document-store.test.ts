import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import type { MemoryItem } from "../src/memory/schemas.js";
import { SqliteDocumentStore } from "../src/memory/storage/sqlite-document-store.js";

function createItem(
  id: string,
  userId: string,
  memoryType: MemoryItem["memoryType"],
): MemoryItem {
  return {
    id,
    userId,
    memoryType,
    content: `${userId} 的 ${memoryType} 记忆`,
    timestamp: "2026-08-19T10:00:00.000Z",
    importance: 0.8,
    metadata: { source: "test" },
  };
}

describe("SqliteDocumentStore", () => {
  const databases: Database.Database[] = [];

  afterEach(() => {
    for (const database of databases) database.close();
    databases.length = 0;
  });

  function createStore(): SqliteDocumentStore {
    const database = new Database(":memory:");
    databases.push(database);
    return new SqliteDocumentStore(database);
  }

  it("支持新增、读取、更新和删除", async () => {
    const store = createStore();
    const item = createItem("memory-1", "user-1", "episodic");

    await store.add(item);
    expect(await store.get(item.id)).toEqual(item);

    await store.update({
      ...item,
      content: "更新后的内容",
      importance: 0.9,
    });

    expect(await store.get(item.id)).toMatchObject({
      content: "更新后的内容",
      importance: 0.9,
    });

    expect(await store.delete(item.id)).toBe(true);
    expect(await store.get(item.id)).toBeUndefined();
  });

  it("所有查询条件都在 SQLite 中完成用户隔离", async () => {
    const store = createStore();
    await store.add(createItem("one", "user-1", "semantic"));
    await store.add(createItem("two", "user-2", "semantic"));

    const items = await store.list({
      userId: "user-1",
      memoryType: "semantic",
      minImportance: 0.5,
    });

    expect(items.map((item) => item.id)).toEqual(["one"]);
  });

  it("clear(filter) 只删除匹配记录", async () => {
    const store = createStore();
    await store.add(createItem("one", "user-1", "episodic"));
    await store.add(createItem("two", "user-2", "episodic"));

    await store.clear({ userId: "user-1" });

    expect(await store.get("one")).toBeUndefined();
    expect(await store.get("two")).toBeDefined();
  });
});
