import { describe, expect, it } from "vitest";

import { HashEmbeddingClient } from "../src/memory/embedding.js";
import type { MemoryItem } from "../src/memory/schemas.js";
import { InMemoryDocumentStore } from "../src/memory/storage/document-store.js";
import { InMemoryVectorStore } from "../src/memory/storage/vector-store.js";
import {
  PerceptualMemory,
  type Modality,
} from "../src/memory/types/perceptual-memory.js";

interface PerceptualItemOptions {
  id: string;
  content: string;
  modality: unknown;
  timestamp?: string;
  userId?: string;
  importance?: number;
}

function createPerceptualItem(options: PerceptualItemOptions): MemoryItem {
  return {
    id: options.id,
    content: options.content,
    memoryType: "perceptual",
    userId: options.userId ?? "user-1",
    timestamp: options.timestamp ?? "2026-08-18T10:00:00.000Z",
    importance: options.importance ?? 0.6,
    metadata: {
      modality: options.modality,
      resourcePath: `/resources/${options.id}`,
    },
  };
}

function createSubject(now: Date = new Date("2026-08-18T12:00:00.000Z")) {
  const documents = new InMemoryDocumentStore();
  const vectors = new InMemoryVectorStore();
  const embeddings = new HashEmbeddingClient(64);

  const memory = new PerceptualMemory(
    documents,
    vectors,
    embeddings,
    () => now,
  );

  return {
    memory,
    documents,
    vectors,
    embeddings,
  };
}

describe("PerceptualMemory", () => {
  it("添加感知记忆时同时写入文档和向量存储", async () => {
    const { memory, documents, vectors, embeddings } = createSubject();

    const item = createPerceptualItem({
      id: "image-1",
      content: "一张包含 TypeScript 函数定义的代码截图",
      modality: "image",
    });

    await memory.add(item);

    expect(await documents.get(item.id)).toEqual(item);

    const queryVector = await embeddings.embed(item.content);

    const vectorHits = await vectors.search(queryVector, 5, {
      userId: "user-1",
      memoryType: "perceptual",
      modality: "image",
    });

    expect(vectorHits).toHaveLength(1);
    expect(vectorHits[0]?.id).toBe("image-1");
    expect(vectorHits[0]?.score).toBeCloseTo(1);
  });

  it("拒绝不支持的感知模态", async () => {
    const { memory } = createSubject();

    const item = createPerceptualItem({
      id: "pdf-1",
      content: "用户上传了一份 PDF",
      modality: "pdf",
    });

    await expect(memory.add(item)).rejects.toThrow();
  });

  it("可以按照目标模态过滤检索结果", async () => {
    const { memory } = createSubject();

    await memory.add(
      createPerceptualItem({
        id: "image-1",
        content: "TypeScript 发布会记录",
        modality: "image",
      }),
    );

    await memory.add(
      createPerceptualItem({
        id: "audio-1",
        content: "TypeScript 发布会记录",
        modality: "audio",
      }),
    );

    const imageResults = await memory.retrieve("TypeScript 发布会记录", {
      userId: "user-1",
      targetModality: "image",
      minImportance: 0,
    });

    expect(imageResults).toHaveLength(1);
    expect(imageResults[0]?.item.id).toBe("image-1");
    expect(imageResults[0]?.item.metadata.modality).toBe("image");

    const audioResults = await memory.retrieve("TypeScript 发布会记录", {
      userId: "user-1",
      targetModality: "audio",
      minImportance: 0,
    });

    expect(audioResults).toHaveLength(1);
    expect(audioResults[0]?.item.id).toBe("audio-1");
  });

  it("内容同样相关时，最近的感知记忆排名更高", async () => {
    const { memory } = createSubject(new Date("2026-08-18T12:00:00.000Z"));

    await memory.add(
      createPerceptualItem({
        id: "old-image",
        content: "TypeScript 代码截图",
        modality: "image",
        timestamp: "2026-08-08T12:00:00.000Z",
      }),
    );

    await memory.add(
      createPerceptualItem({
        id: "recent-image",
        content: "TypeScript 代码截图",
        modality: "image",
        timestamp: "2026-08-18T11:00:00.000Z",
      }),
    );

    const results = await memory.retrieve("TypeScript 代码截图", {
      userId: "user-1",
      targetModality: "image",
      minImportance: 0,
    });

    expect(results).toHaveLength(2);
    expect(results[0]?.item.id).toBe("recent-image");
    expect(results[1]?.item.id).toBe("old-image");

    expect(results[0]?.signals.recency).toBeGreaterThan(
      results[1]?.signals.recency ?? 0,
    );
    expect(results[0]?.score).toBeGreaterThan(results[1]?.score ?? 0);
  });

  it("检索时不会返回其他用户的感知记忆", async () => {
    const { memory } = createSubject();

    await memory.add(
      createPerceptualItem({
        id: "user-1-image",
        content: "TypeScript 代码截图",
        modality: "image",
        userId: "user-1",
      }),
    );

    await memory.add(
      createPerceptualItem({
        id: "user-2-image",
        content: "TypeScript 代码截图",
        modality: "image",
        userId: "user-2",
      }),
    );

    const results = await memory.retrieve("TypeScript 代码截图", {
      userId: "user-1",
      targetModality: "image",
      minImportance: 0,
    });

    expect(results.map((result) => result.item.id)).toEqual(["user-1-image"]);
  });

  it("可以按照模态列出指定用户的感知记忆", async () => {
    const { memory } = createSubject();

    const items: Array<{
      id: string;
      modality: Modality;
    }> = [
      {
        id: "image-1",
        modality: "image",
      },
      {
        id: "image-2",
        modality: "image",
      },
      {
        id: "audio-1",
        modality: "audio",
      },
    ];

    for (const item of items) {
      await memory.add(
        createPerceptualItem({
          id: item.id,
          content: `${item.modality} 感知内容`,
          modality: item.modality,
        }),
      );
    }

    const images = await memory.getByModality("user-1", "image");

    expect(images.map((item) => item.id)).toEqual(["image-1", "image-2"]);
  });

  it("删除感知记忆时同时删除文档和向量", async () => {
    const { memory, documents, vectors, embeddings } = createSubject();

    const item = createPerceptualItem({
      id: "image-1",
      content: "TypeScript 代码截图",
      modality: "image",
    });

    await memory.add(item);

    expect(await memory.remove(item.id)).toBe(true);
    expect(await documents.get(item.id)).toBeUndefined();

    const queryVector = await embeddings.embed(item.content);

    const vectorHits = await vectors.search(queryVector, 5, {
      userId: "user-1",
      memoryType: "perceptual",
      modality: "image",
    });

    expect(vectorHits).toEqual([]);
  });

  it("拒绝空查询", async () => {
    const { memory } = createSubject();

    await expect(
      memory.retrieve("  ", {
        userId: "user-1",
      }),
    ).rejects.toThrow("感知记忆查询不能为空");
  });
});
