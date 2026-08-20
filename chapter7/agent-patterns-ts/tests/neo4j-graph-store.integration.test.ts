import { randomUUID } from "node:crypto";
import neo4j from "neo4j-driver";
import { describe, expect, it } from "vitest";
import type {
  Entity,
  Relation,
} from "../src/memory/storage/graph-store.js";
import { Neo4jGraphStore } from "../src/memory/storage/neo4j-graph-store.js";

const describeIntegration =
  process.env.RUN_MEMORY_INTEGRATION_TESTS === "true"
    ? describe
    : describe.skip;

function entity(
  id: string,
  userId: string,
  name: string,
): Entity {
  return {
    id,
    userId,
    name,
    type: "concept",
    properties: {},
  };
}

function relation(
  userId: string,
  sourceId: string,
  targetId: string,
  memoryId: string,
): Relation {
  return {
    id: randomUUID(),
    userId,
    sourceId,
    targetId,
    type: "LIKES",
    memoryId,
    properties: {},
  };
}

describeIntegration("Neo4jGraphStore integration", () => {
  it("图检索、删除和清空都保持用户隔离", async () => {
    const driver = neo4j.driver(
      process.env.NEO4J_URI ?? "bolt://127.0.0.1:7687",
      neo4j.auth.basic(
        process.env.NEO4J_USERNAME ?? "neo4j",
        process.env.NEO4J_PASSWORD ?? "change-me-in-local-env",
      ),
    );
    const store = new Neo4jGraphStore({
      driver,
      database: process.env.NEO4J_DATABASE ?? "neo4j",
    });
    const userOne = `test-user-${randomUUID()}`;
    const userTwo = `test-user-${randomUUID()}`;
    const userOneMemoryId = randomUUID();
    const userTwoMemoryId = randomUUID();
    const oneSource = entity(randomUUID(), userOne, "用户");
    const oneTarget = entity(randomUUID(), userOne, "TypeScript");
    const twoSource = entity(randomUUID(), userTwo, "用户");
    const twoTarget = entity(randomUUID(), userTwo, "TypeScript");

    try {
      await store.initialize();

      for (const item of [
        oneSource,
        oneTarget,
        twoSource,
        twoTarget,
      ]) {
        await store.addEntity(item);
      }

      await store.addRelation(
        relation(
          userOne,
          oneSource.id,
          oneTarget.id,
          userOneMemoryId,
        ),
      );
      await store.addRelation(
        relation(
          userOne,
          oneSource.id,
          oneTarget.id,
          userOneMemoryId,
        ),
      );
      await store.addRelation(
        relation(
          userTwo,
          twoSource.id,
          twoTarget.id,
          userTwoMemoryId,
        ),
      );

      expect(await store.listMemoryIds(userOne)).toEqual([
        userOneMemoryId,
      ]);
      expect(await store.listMemoryIds(userTwo)).toEqual([
        userTwoMemoryId,
      ]);
      expect(await store.listMemoryIds()).toEqual(
        [userOneMemoryId, userTwoMemoryId].sort(),
      );

      const userOneHits = await store.findRelatedMemories(
        [oneSource],
        userOne,
      );

      expect(userOneHits.map((hit) => hit.memoryId)).toEqual([
        userOneMemoryId,
      ]);

      await store.deleteByMemoryId(userOneMemoryId);

      expect(
        await store.findRelatedMemories([oneSource], userOne),
      ).toEqual([]);

      await store.clear(userOne);

      const userTwoHits = await store.findRelatedMemories(
        [twoSource],
        userTwo,
      );
      expect(userTwoHits.map((hit) => hit.memoryId)).toEqual([
        userTwoMemoryId,
      ]);
    } finally {
      try {
        await store.clear(userOne);
        await store.clear(userTwo);
      } finally {
        await driver.close();
      }
    }
  });
});
