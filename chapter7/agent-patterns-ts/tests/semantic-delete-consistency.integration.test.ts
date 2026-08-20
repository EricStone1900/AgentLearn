import "dotenv/config";
import { randomUUID } from "node:crypto";
import { QdrantClient } from "@qdrant/js-client-rest";
import Database from "better-sqlite3";
import neo4j, { type Driver } from "neo4j-driver";
import { describe, expect, it } from "vitest";
import { HashEmbeddingClient } from "../src/memory/embedding.js";
import { RuleBasedKnowledgeExtractor } from "../src/memory/knowledge-extractor.js";
import type { MemoryItem } from "../src/memory/schemas.js";
import { Neo4jGraphStore } from "../src/memory/storage/neo4j-graph-store.js";
import { QdrantVectorStore } from "../src/memory/storage/qdrant-vector-store.js";
import { SqliteDocumentStore } from "../src/memory/storage/sqlite-document-store.js";
import { SemanticMemory } from "../src/memory/types/semantic-memory.js";

/*
 * 普通 npm test 不应该依赖本地数据库服务。
 * 只有显式设置 RUN_MEMORY_INTEGRATION_TESTS=true 时才执行。
 */
const describeIntegration =
  process.env.RUN_MEMORY_INTEGRATION_TESTS === "true"
    ? describe
    : describe.skip;

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

  if (neo4j.isInt(value)) {
    return value.toNumber();
  }

  return Number(value ?? 0);
}

describeIntegration("SemanticMemory delete consistency integration", () => {
  it("删除语义记忆后 SQLite、Qdrant 和 Neo4j 都不存在目标 ID", async () => {
    /*
     * 每次测试使用独立 userId 和 collection，
     * 避免污染开发数据，也避免并发测试互相干扰。
     */
    const userId = `test-user-${randomUUID()}`;
    const memoryId = randomUUID();
    const collectionName = `test_semantic_delete_${randomUUID().replaceAll("-", "_")}`;
    const dimension = 64;
    const neo4jDatabase = process.env.NEO4J_DATABASE ?? "neo4j";

    /*
     * SQLite 使用真实数据库引擎，但数据库只存在于本测试进程内。
     * 测试结束关闭连接后自动消失。
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

    const memory = new SemanticMemory(
      documents,
      vectors,
      new HashEmbeddingClient(dimension),
      graph,
      new RuleBasedKnowledgeExtractor(),
    );

    /*
     * 这段内容必须能被 RuleBasedKnowledgeExtractor
     * 提取出实体和关系。
     *
     * “用户喜欢TypeScript”会生成 LIKES 关系；
     * 如果只写一个没有关系的普通句子，Neo4j 中可能只有实体，
     * 无法完成 relation 的删除断言。
     */
    const item: MemoryItem = {
      id: memoryId,
      content: "用户喜欢TypeScript",
      memoryType: "semantic",
      userId,
      timestamp: "2026-08-20T10:00:00.000Z",
      importance: 0.9,
      metadata: {
        source: "semantic-delete-consistency-test",
      },
    };

    try {
      /*
       * 构造函数不能 await，所以在真正写数据前，
       * 显式等待 Qdrant collection、payload index
       * 和 Neo4j constraint 初始化完成。
       */
      await vectors.initialize();
      await driver.verifyConnectivity();
      await graph.initialize();

      // 第一步：通过 SemanticMemory 写入三个后端。
      await memory.add(item);

      /*
       * 第二步：直接检查 SQLite。
       * SemanticMemory.add() 会补充 entityIds 元数据，
       * 所以这里使用 toMatchObject，而不是与原 item 完全相等。
       */
      const storedDocument = await documents.get(memoryId);

      expect(storedDocument).toMatchObject({
        id: memoryId,
        userId,
        memoryType: "semantic",
        content: "用户喜欢TypeScript",
      });
      expect(storedDocument?.metadata.entityIds).toEqual(expect.any(Array));

      // 第三步：绕过 VectorStore 搜索，按 ID 直接检查 Qdrant point。
      const pointsBeforeDelete = await qdrant.retrieve(collectionName, {
        ids: [memoryId],
        with_payload: true,
        with_vector: false,
      });

      expect(pointsBeforeDelete).toHaveLength(1);
      expect(pointsBeforeDelete[0]?.id).toBe(memoryId);
      expect(pointsBeforeDelete[0]?.payload).toMatchObject({
        memoryId,
        userId,
        memoryType: "semantic",
      });

      // 第四步：通过 Cypher 按 memoryId 直接检查 Neo4j 关系。
      const graphRelationsBeforeDelete = await countGraphRelations(
        driver,
        neo4jDatabase,
        memoryId,
      );

      expect(graphRelationsBeforeDelete).toBeGreaterThan(0);

      // 第五步：只调用领域对象的 remove，不直接删除三个后端。
      const removed = await memory.remove(memoryId);

      expect(removed).toBe(true);

      // 第六步：再次直接检查 SQLite。
      expect(await documents.get(memoryId)).toBeUndefined();
      expect(await memory.has(memoryId)).toBe(false);

      // 第七步：再次按 ID 检查 Qdrant。
      const pointsAfterDelete = await qdrant.retrieve(collectionName, {
        ids: [memoryId],
        with_payload: true,
        with_vector: false,
      });

      expect(pointsAfterDelete).toEqual([]);

      // 第八步：再次检查 Neo4j。
      const graphRelationsAfterDelete = await countGraphRelations(
        driver,
        neo4jDatabase,
        memoryId,
      );

      expect(graphRelationsAfterDelete).toBe(0);
    } finally {
      /*
       * 即使中间断言失败，也尽量清理本测试创建的数据。
       * allSettled 防止一个清理失败阻止其他资源释放。
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
