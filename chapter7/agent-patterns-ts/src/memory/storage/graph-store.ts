export interface Entity {
  id: string;
  userId: string;
  name: string;
  type: string;
  properties: Record<string, unknown>;
}

export interface Relation {
  id: string;
  userId: string;
  sourceId: string;
  targetId: string;
  type: string;
  memoryId: string;
  properties: Record<string, unknown>;
}

export interface GraphSearchHit {
  memoryId: string;
  score: number;
}

export interface GraphStore {
  addEntity(entity: Entity): Promise<void>;
  addRelation(relation: Relation): Promise<void>;
  findRelatedMemories(
    entities: Entity[],
    userId: string,
    maxDepth?: number,
  ): Promise<GraphSearchHit[]>;
  deleteByMemoryId(memoryId: string): Promise<void>;
  clear(userId?: string): Promise<void>;
}

export class InMemoryGraphStore implements GraphStore {
  private readonly entities = new Map<string, Entity>();
  private readonly relations = new Map<string, Relation>();

  public async addEntity(entity: Entity): Promise<void> {
    this.entities.set(entity.id, structuredClone(entity));
  }

  public async addRelation(relation: Relation): Promise<void> {
    if (!this.entities.has(relation.sourceId)) {
      throw new Error(`关系源实体不存在：${relation.sourceId}`);
    }
    if (!this.entities.has(relation.targetId)) {
      throw new Error(`关系目标实体不存在：${relation.targetId}`);
    }
    this.relations.set(relation.id, structuredClone(relation));
  }

  public async findRelatedMemories(
    entities: Entity[],
    userId: string,
    maxDepth = 2,
  ): Promise<GraphSearchHit[]> {
    const queue = entities.map((entity) => ({ id: entity.id, depth: 0 }));
    const visited = new Set<string>();
    const scores = new Map<string, number>();

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current || visited.has(current.id) || current.depth > maxDepth) continue;
      visited.add(current.id);

      for (const relation of this.relations.values()) {
        if (relation.userId !== userId) continue;

        const touchesSource = relation.sourceId === current.id;
        const touchesTarget = relation.targetId === current.id;
        if (!touchesSource && !touchesTarget) continue;

        const relationScore = 1 / (1 + current.depth);
        scores.set(
          relation.memoryId,
          Math.max(scores.get(relation.memoryId) ?? 0, relationScore),
        );

        if (current.depth < maxDepth) {
          queue.push({
            id: touchesSource ? relation.targetId : relation.sourceId,
            depth: current.depth + 1,
          });
        }
      }
    }

    return [...scores.entries()]
      .map(([memoryId, score]) => ({ memoryId, score }))
      .sort((left, right) => right.score - left.score);
  }

  public async deleteByMemoryId(memoryId: string): Promise<void> {
    for (const [id, relation] of this.relations) {
      if (relation.memoryId === memoryId) this.relations.delete(id);
    }

    const referenced = new Set<string>();
    for (const relation of this.relations.values()) {
      referenced.add(relation.sourceId);
      referenced.add(relation.targetId);
    }

    for (const id of this.entities.keys()) {
      if (!referenced.has(id)) this.entities.delete(id);
    }
  }

  public async clear(userId?: string): Promise<void> {
    if (!userId) {
      this.entities.clear();
      this.relations.clear();
      return;
    }

    for (const [id, relation] of this.relations) {
      if (relation.userId === userId) this.relations.delete(id);
    }
    for (const [id, entity] of this.entities) {
      if (entity.userId === userId) this.entities.delete(id);
    }
  }
}