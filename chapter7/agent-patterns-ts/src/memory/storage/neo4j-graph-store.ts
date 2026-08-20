import type { Driver } from "neo4j-driver";
import type {
  Entity,
  GraphSearchHit,
  GraphStore,
  Relation,
} from "./graph-store.js";

export interface Neo4jGraphStoreOptions {
  driver: Driver;
  database: string;
}

export class Neo4jGraphStore implements GraphStore {
  private readonly ready: Promise<void>;

  public constructor(private readonly options: Neo4jGraphStoreOptions) {
    this.ready = this.ensureSchema();
  }

  private async ensureSchema(): Promise<void> {
    await this.options.driver.executeQuery(
      [
        "CREATE CONSTRAINT memory_entity_id IF NOT EXISTS",
        "FOR (entity:MemoryEntity)",
        "REQUIRE entity.id IS UNIQUE",
      ].join(" "),
      {},
      { database: this.options.database },
    );
  }

  public async initialize(): Promise<void> {
    await this.ready;
  }

  public async addEntity(entity: Entity): Promise<void> {
    await this.ready;

    await this.options.driver.executeQuery(
      [
        "MERGE (entity:MemoryEntity {id: $id})",
        "SET entity.userId = $userId,",
        "    entity.name = $name,",
        "    entity.type = $type,",
        "    entity.propertiesJson = $propertiesJson",
      ].join("\n"),
      {
        id: entity.id,
        userId: entity.userId,
        name: entity.name,
        type: entity.type,
        propertiesJson: JSON.stringify(entity.properties),
      },
      { database: this.options.database },
    );
  }

  public async addRelation(relation: Relation): Promise<void> {
    await this.ready;

    const result = await this.options.driver.executeQuery(
      [
        "MATCH (source:MemoryEntity {id: $sourceId, userId: $userId})",
        "MATCH (target:MemoryEntity {id: $targetId, userId: $userId})",
        "MERGE (source)-[edge:MEMORY_RELATION {id: $id}]->(target)",
        "SET edge.userId = $userId,",
        "    edge.type = $type,",
        "    edge.memoryId = $memoryId,",
        "    edge.propertiesJson = $propertiesJson",
        "RETURN edge.id AS id",
      ].join("\n"),
      {
        id: relation.id,
        userId: relation.userId,
        sourceId: relation.sourceId,
        targetId: relation.targetId,
        type: relation.type,
        memoryId: relation.memoryId,
        propertiesJson: JSON.stringify(relation.properties),
      },
      { database: this.options.database },
    );

    if (result.records.length !== 1) {
      throw new Error(
        `无法创建关系 ${relation.id}：源实体或目标实体不存在`,
      );
    }
  }

  public async findRelatedMemories(
    entities: Entity[],
    userId: string,
    maxDepth = 2,
  ): Promise<GraphSearchHit[]> {
    await this.ready;
    if (entities.length === 0) return [];

    const depth = Math.max(1, Math.min(5, Math.trunc(maxDepth)));
    const entityIds = entities
      .filter((entity) => entity.userId === userId)
      .map((entity) => entity.id);

    if (entityIds.length === 0) return [];

    /*
     * Cypher 的可变路径深度不能使用普通参数代替，
     * 所以这里只拼接经过整数截断和范围限制的 depth。
     */
    const query = [
      "MATCH (start:MemoryEntity)",
      "WHERE start.userId = $userId AND start.id IN $entityIds",
      `MATCH path = (start)-[:MEMORY_RELATION*1..${depth}]-(related)`,
      "WHERE related.userId = $userId",
      "  AND all(edge IN relationships(path) WHERE edge.userId = $userId)",
      "UNWIND relationships(path) AS edge",
      "WITH edge.memoryId AS memoryId,",
      "     max(1.0 / length(path)) AS score",
      "RETURN memoryId, score",
      "ORDER BY score DESC",
    ].join("\n");

    const result = await this.options.driver.executeQuery(
      query,
      { userId, entityIds },
      { database: this.options.database },
    );

    return result.records.map((record) => ({
      memoryId: String(record.get("memoryId")),
      score: Number(record.get("score")),
    }));
  }

  public async deleteByMemoryId(memoryId: string): Promise<void> {
    await this.ready;

    await this.options.driver.executeQuery(
      [
        "MATCH (source)-[edge:MEMORY_RELATION {memoryId: $memoryId}]-(target)",
        "WITH collect(DISTINCT source) + collect(DISTINCT target) AS candidates,",
        "     collect(DISTINCT edge) AS edges",
        "FOREACH (item IN edges | DELETE item)",
        "WITH candidates",
        "UNWIND candidates AS entity",
        "WITH DISTINCT entity",
        "WHERE NOT (entity)-[:MEMORY_RELATION]-()",
        "DELETE entity",
      ].join("\n"),
      { memoryId },
      { database: this.options.database },
    );
  }

  public async clear(userId?: string): Promise<void> {
    await this.ready;

    if (!userId) {
      await this.options.driver.executeQuery(
        "MATCH (entity:MemoryEntity) DETACH DELETE entity",
        {},
        { database: this.options.database },
      );
      return;
    }

    await this.options.driver.executeQuery(
      [
        "MATCH (entity:MemoryEntity {userId: $userId})",
        "DETACH DELETE entity",
      ].join("\n"),
      { userId },
      { database: this.options.database },
    );
  }
}