import { describe, expect, it } from "vitest";

import { HashEmbeddingClient } from "../src/memory/embedding.js";
import type { MemoryItem } from "../src/memory/schemas.js";
import { InMemoryDocumentStore } from "../src/memory/storage/document-store.js";
import { InMemoryVectorStore } from "../src/memory/storage/vector-store.js";
import { EpisodicMemory } from "../src/memory/types/episodic-memory.js";

interface EpisodeOptions {
  id: string;
  content: string;
  timestamp: string;
  userId?: string;
  importance?: number;
  sessionId?: string;
}

function createEpisode(options: EpisodeOptions): MemoryItem {
  return {
    id: options.id,
    content: options.content,
    memoryType: "episodic",
    userId: options.userId ?? "user-1",
    timestamp: options.timestamp,
    importance: options.importance ?? 0.5,
    metadata: {
      sessionId: options.sessionId ?? "session-1",
      eventType: "learning",
    },
  };
}

function createSubject(now: Date = new Date("2026-08-18T12:00:00.000Z")) {
  const documents = new InMemoryDocumentStore();
  const vectors = new InMemoryVectorStore();
  const embeddings = new HashEmbeddingClient(64);
  const memory = new EpisodicMemory(documents, vectors, embeddings, () => now);

  return {
    memory,
    documents,
    vectors,
    embeddings,
  };
}

describe("EpisodicMemory", () => {
  it("添加记忆时同时写入文档存储和向量存储", async () => {
    const { memory, documents, vectors, embeddings } = createSubject();

    const item = createEpisode({
      id: "episode-1",
      content: "用户完成了 TypeScript Agent 示例",
      timestamp: "2026-08-18T10:00:00.000Z",
    });

    const memoryId = await memory.add(item);

    expect(memoryId).toBe("episode-1");

    const storedDocument = await documents.get("episode-1");

    expect(storedDocument).toEqual(item);

    const queryVector = await embeddings.embed(item.content);

    const vectorHits = await vectors.search(queryVector, 5, {
      userId: "user-1",
      memoryType: "episodic",
    });

    expect(vectorHits).toHaveLength(1);
    expect(vectorHits[0]?.id).toBe("episode-1");
    expect(vectorHits[0]?.score).toBeCloseTo(1);
  });

  it("可以按照会话获取情景记忆，并按时间正序排列", async () => {
    const { memory } = createSubject();

    await memory.add(
      createEpisode({
        id: "episode-2",
        content: "第二次提问",
        timestamp: "2026-08-18T10:20:00.000Z",
        sessionId: "session-a",
      }),
    );

    await memory.add(
      createEpisode({
        id: "episode-1",
        content: "第一次提问",
        timestamp: "2026-08-18T10:10:00.000Z",
        sessionId: "session-a",
      }),
    );

    await memory.add(
      createEpisode({
        id: "episode-3",
        content: "其他会话中的提问",
        timestamp: "2026-08-18T10:30:00.000Z",
        sessionId: "session-b",
      }),
    );

    const episodes = await memory.getSessionEpisodes("user-1", "session-a");

    expect(episodes.map((item) => item.id)).toEqual(["episode-1", "episode-2"]);
  });

  it("可以获取按时间倒序排列的事件时间线", async () => {
    const { memory } = createSubject();

    await memory.add(
      createEpisode({
        id: "old",
        content: "较早发生的事件",
        timestamp: "2026-08-16T10:00:00.000Z",
      }),
    );

    await memory.add(
      createEpisode({
        id: "new",
        content: "最近发生的事件",
        timestamp: "2026-08-18T10:00:00.000Z",
      }),
    );

    const timeline = await memory.getTimeline("user-1");

    expect(timeline.map((item) => item.id)).toEqual(["new", "old"]);
  });

  it("内容同样相关时，最近的情景记忆排名更高", async () => {
    const { memory } = createSubject(new Date("2026-08-18T12:00:00.000Z"));

    await memory.add(
      createEpisode({
        id: "old",
        content: "用户学习 TypeScript",
        timestamp: "2026-08-08T12:00:00.000Z",
        importance: 0.5,
      }),
    );

    await memory.add(
      createEpisode({
        id: "recent",
        content: "用户学习 TypeScript",
        timestamp: "2026-08-18T11:00:00.000Z",
        importance: 0.5,
      }),
    );

    const results = await memory.retrieve("用户学习 TypeScript", {
      userId: "user-1",
      limit: 5,
      minImportance: 0,
    });

    expect(results).toHaveLength(2);
    expect(results[0]?.item.id).toBe("recent");
    expect(results[1]?.item.id).toBe("old");

    expect(results[0]?.signals.vector).toBeCloseTo(1);
    expect(results[0]?.signals.recency).toBeGreaterThan(
      results[1]?.signals.recency ?? 0,
    );
    expect(results[0]?.score).toBeGreaterThan(results[1]?.score ?? 0);
  });

  it("检索时不会返回其他用户的记忆", async () => {
    const { memory } = createSubject();

    await memory.add(
      createEpisode({
        id: "user-1-memory",
        content: "用户学习 TypeScript",
        timestamp: "2026-08-18T10:00:00.000Z",
        userId: "user-1",
      }),
    );

    await memory.add(
      createEpisode({
        id: "user-2-memory",
        content: "用户学习 TypeScript",
        timestamp: "2026-08-18T10:00:00.000Z",
        userId: "user-2",
      }),
    );

    const results = await memory.retrieve("用户学习 TypeScript", {
      userId: "user-1",
      minImportance: 0,
    });

    expect(results.map((result) => result.item.id)).toEqual(["user-1-memory"]);
  });

  it("删除记忆时同时删除文档和向量", async () => {
    const { memory, documents, vectors, embeddings } = createSubject();

    const item = createEpisode({
      id: "episode-1",
      content: "用户完成了 TypeScript 示例",
      timestamp: "2026-08-18T10:00:00.000Z",
    });

    await memory.add(item);

    const removed = await memory.remove(item.id);

    expect(removed).toBe(true);
    expect(await documents.get(item.id)).toBeUndefined();
    expect(await memory.has(item.id)).toBe(false);

    const queryVector = await embeddings.embed(item.content);

    const vectorHits = await vectors.search(queryVector, 5, {
      userId: "user-1",
      memoryType: "episodic",
    });

    expect(vectorHits).toEqual([]);
  });

  it("拒绝空查询", async () => {
    const { memory } = createSubject();

    await expect(
      memory.retrieve("   ", {
        userId: "user-1",
      }),
    ).rejects.toThrow("情景记忆查询不能为空");
  });
});
