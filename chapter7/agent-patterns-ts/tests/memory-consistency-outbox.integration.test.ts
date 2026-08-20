import "dotenv/config";
import { randomUUID } from "node:crypto";
import { QdrantClient } from "@qdrant/js-client-rest";
import Database from "better-sqlite3";
import neo4j, { type Driver } from "neo4j-driver";
import { describe, expect, it } from "vitest";
import { enqueueConsistencyRepairs } from "../src/memory/consistency/enqueue-consistency-repairs.js";
import { MemoryConsistencyScanner } from "../src/memory/consistency/memory-consistency-scanner.js";
import { MemoryOutboxWorker } from "../src/memory/consistency/memory-outbox-worker.js";
import { SqliteMemoryOutbox } from "../src/memory/consistency/sqlite-memory-outbox.js";
import { HashEmbeddingClient } from "../src/memory/embedding.js";
import { Neo4jGraphStore } from "../src/memory/storage/neo4j-graph-store.js";
import { QdrantVectorStore } from "../src/memory/storage/qdrant-vector-store.js";
import { SqliteDocumentStore } from "../src/memory/storage/sqlite-document-store.js";

/*
 * 普通 npm test 不连接外部数据库。
 * 只有显式设置开关时才执行这组真实集成测试。
 */
const describeIntegration =
  process.env.RUN_MEMORY_INTEGRATION_TESTS === "true"
    ? describe
    : describe.skip;

/** 直接通过 Cypher 统计指定 memoryId 的真实关系数量。 */
async function countGraphRelations(
  driver: Driver,
  database: string,
  memoryId: string,
): Promise<number> {
  const result = await driver.executeQuery(
    [
      "MATCH ()-[edge:MEMORY_RELATION {memoryId: $memoryId}]->()",
      "RETURN count(edge) AS count",
    ].join("\n"),
    { memoryId },
    { database },
  );

  const value = result.records[0]?.get("count");

  /* Neo4j count() 返回 Integer，需要显式转换成普通 number。 */
  if (neo4j.isInt(value)) return value.toNumber();
  return Number(value ?? 0);
}

/** 直接检查指定 Qdrant point 是否存在，不通过 VectorStore.search()。 */
async function retrievePoint(
  client: QdrantClient,
  collectionName: string,
  memoryId: string,
) {
  return client.retrieve(collectionName, {
    ids: [memoryId],
    with_payload: true,
    with_vector: false,
  });
}

describeIntegration("Memory consistency outbox integration", () => {
  it("通过 outbox 修复缺失向量、孤立向量和孤立图关系", async () => {
    /*
     * 每次执行都使用随机 userId、ID 和 collection。
     * 这样不会污染开发数据，并行测试之间也不会互相干扰。
     */
    const userId = `consistency-user-${randomUUID()}`;
    const missingVectorId = randomUUID();
    const orphanVectorId = randomUUID();
    const orphanGraphId = randomUUID();
    const graphSourceId = randomUUID();
    const graphTargetId = randomUUID();
    const graphRelationId = randomUUID();
    const collectionName = `test_memory_consistency_${randomUUID().replaceAll("-", "_")}`;
    const dimension = 64;
    const neo4jDatabase = process.env.NEO4J_DATABASE ?? "neo4j";

    /*
     * 使用真实 better-sqlite3 引擎，但数据库只存在于当前进程内。
     * sqlite.close() 后数据自动消失。
     */
    const sqlite = new Database(":memory:");
    const documents = new SqliteDocumentStore(sqlite);

    const qdrant = new QdrantClient({
      url: process.env.QDRANT_URL ?? "http://127.0.0.1:6333",
      ...(process.env.QDRANT_API_KEY
        ? { apiKey: process.env.QDRANT_API_KEY }
        : {}),
    });
    const vectors = new QdrantVectorStore({
      client: qdrant,
      collectionName,
      dimension,
    });

    const driver = neo4j.driver(
      process.env.NEO4J_URI ?? "bolt://127.0.0.1:7687",
      neo4j.auth.basic(
        process.env.NEO4J_USERNAME ?? "neo4j",
        process.env.NEO4J_PASSWORD ?? "change-me-in-local-env",
      ),
    );
    const graph = new Neo4jGraphStore({
      driver,
      database: neo4jDatabase,
    });

    const embeddings = new HashEmbeddingClient(dimension);
    const scanner = new MemoryConsistencyScanner(
      documents,
      vectors,
      graph,
      embeddings,
    );
    const outbox = new SqliteMemoryOutbox(sqlite);
    const worker = new MemoryOutboxWorker(
      outbox,
      documents,
      vectors,
      graph,
      embeddings,
      3,
    );

    try {
      /*
       * Qdrant/Neo4j 的构造函数会启动异步初始化，
       * 注入测试数据之前要显式等待初始化完成。
       */
      await vectors.initialize();
      await driver.verifyConnectivity();
      await graph.initialize();

      /*
       * 第一步：只写 SQLite，制造“SQLite 有、Qdrant 无”。
       * 不能调用 SemanticMemory.add()，否则它会同时写入 Qdrant。
       */
      await documents.add({
        id: missingVectorId,
        content: "用户喜欢 TypeScript",
        memoryType: "semantic",
        userId,
        timestamp: "2026-08-20T10:00:00.000Z",
        importance: 0.9,
        metadata: {
          source: "consistency-integration",
        },
      });

      /*
       * 第二步：只写 Qdrant，制造“Qdrant 有、SQLite 无”。
       * point.id 和 payload.memoryId 必须遵守同 ID 约定。
       */
      await vectors.upsert([
        {
          id: orphanVectorId,
          vector: await embeddings.embed("这是一条孤立向量"),
          metadata: {
            memoryId: orphanVectorId,
            userId,
            memoryType: "semantic",
            importance: 0.5,
            source: "consistency-integration",
          },
        },
      ]);

      /*
       * 第三步：只写 Neo4j，制造“Neo4j 有关系、SQLite 无”。
       * addRelation() 要求源实体和目标实体已经存在。
       */
      await graph.addEntity({
        id: graphSourceId,
        userId,
        name: "用户",
        type: "person",
        properties: {},
      });
      await graph.addEntity({
        id: graphTargetId,
        userId,
        name: "TypeScript",
        type: "technology",
        properties: {},
      });
      await graph.addRelation({
        id: graphRelationId,
        userId,
        sourceId: graphSourceId,
        targetId: graphTargetId,
        type: "LIKES",
        memoryId: orphanGraphId,
        properties: {},
      });

      /*
       * 第四步：修复前先直接检查三个后端，证明漂移确实制造成功。
       */
      expect(await documents.get(missingVectorId)).toMatchObject({
        id: missingVectorId,
        userId,
        memoryType: "semantic",
      });
      expect(await documents.get(orphanVectorId)).toBeUndefined();
      expect(await documents.get(orphanGraphId)).toBeUndefined();

      expect(
        await retrievePoint(qdrant, collectionName, missingVectorId),
      ).toEqual([]);

      const orphanVectorBefore = await retrievePoint(
        qdrant,
        collectionName,
        orphanVectorId,
      );
      expect(orphanVectorBefore).toHaveLength(1);
      expect(orphanVectorBefore[0]?.payload).toMatchObject({
        memoryId: orphanVectorId,
        userId,
      });

      expect(
        await countGraphRelations(driver, neo4jDatabase, orphanGraphId),
      ).toBe(1);

      /*
       * 第五步：只读扫描必须精确报告三种漂移，不能修改数据。
       */
      const reportBefore = await scanner.scan({ userId });

      expect(reportBefore).toEqual({
        missingVectorIds: [missingVectorId],
        orphanVectorIds: [orphanVectorId],
        orphanGraphMemoryIds: [orphanGraphId],
      });

      /* 再次直接检查，证明 scan() 本身没有执行修复。 */
      expect(
        await retrievePoint(qdrant, collectionName, missingVectorId),
      ).toEqual([]);
      expect(
        await retrievePoint(qdrant, collectionName, orphanVectorId),
      ).toHaveLength(1);
      expect(
        await countGraphRelations(driver, neo4jDatabase, orphanGraphId),
      ).toBe(1);

      /* 第六步：扫描结果只进入 outbox，不直接修复外部后端。 */
      const queued = enqueueConsistencyRepairs(reportBefore, outbox);

      expect(queued.enqueuedTaskIds).toHaveLength(3);
      expect(queued.duplicateTaskCount).toBe(0);
      expect(outbox.list()).toHaveLength(3);
      expect(
        outbox.list().every((task) => task.status === "PENDING"),
      ).toBe(true);

      /* 第七步：重复入队不会产生另外三行。 */
      const duplicate = enqueueConsistencyRepairs(reportBefore, outbox);
      expect(duplicate.enqueuedTaskIds).toEqual([]);
      expect(duplicate.duplicateTaskCount).toBe(3);
      expect(outbox.list()).toHaveLength(3);

      /*
       * 第八步：入队阶段不能修改外部后端。
       * 缺失向量仍然缺失、孤立向量和孤立图关系仍然存在。
       */
      expect(
        await retrievePoint(qdrant, collectionName, missingVectorId),
      ).toEqual([]);
      expect(
        await retrievePoint(qdrant, collectionName, orphanVectorId),
      ).toHaveLength(1);
      expect(
        await countGraphRelations(driver, neo4jDatabase, orphanGraphId),
      ).toBe(1);

      /* 第九步：只有 worker 执行实际修复。 */
      const workerResult = await worker.runUntilEmpty();

      expect(workerResult).toEqual({
        completed: 3,
        failed: 0,
        deadLettered: 0,
      });
      expect(
        outbox
          .list()
          .every((task) => task.status === "COMPLETED" && task.attempts === 1),
      ).toBe(true);

      /* 第十步：重新扫描应无不一致。 */
      await expect(scanner.scan({ userId })).resolves.toEqual({
        missingVectorIds: [],
        orphanVectorIds: [],
        orphanGraphMemoryIds: [],
      });

      /*
       * 第十一步：直接检查 SQLite。
       * 修复缺失向量不能删除或修改权威文档。
       */
      expect(await documents.get(missingVectorId)).toMatchObject({
        id: missingVectorId,
        content: "用户喜欢 TypeScript",
        userId,
        memoryType: "semantic",
        importance: 0.9,
        metadata: {
          source: "consistency-integration",
        },
      });
      expect(await documents.get(orphanVectorId)).toBeUndefined();
      expect(await documents.get(orphanGraphId)).toBeUndefined();

      /*
       * 第十二步：直接检查 Qdrant。
       * missingVectorId 应被重新计算 Embedding 并 upsert；
       * orphanVectorId 应被删除。
       */
      const repairedVector = await retrievePoint(
        qdrant,
        collectionName,
        missingVectorId,
      );

      expect(repairedVector).toHaveLength(1);
      expect(repairedVector[0]?.id).toBe(missingVectorId);
      expect(repairedVector[0]?.payload).toMatchObject({
        memoryId: missingVectorId,
        userId,
        memoryType: "semantic",
        importance: 0.9,
        source: "consistency-integration",
      });

      expect(
        await retrievePoint(qdrant, collectionName, orphanVectorId),
      ).toEqual([]);

      /*
       * 第十三步：直接检查 Neo4j。
       */
      expect(
        await countGraphRelations(driver, neo4jDatabase, orphanGraphId),
      ).toBe(0);
    } finally {
      /*
       * 任一断言失败也必须清理测试资源。
       * allSettled 确保一个清理失败不会阻止另一个清理。
       */
      await Promise.allSettled([
        graph.clear(userId),
        qdrant.deleteCollection(collectionName),
      ]);

      await driver.close();
      sqlite.close();
    }
  }, 60_000);
});
