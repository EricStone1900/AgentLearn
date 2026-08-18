export interface Entity {
  id: string;
  name: string;
  type: string;
  properties: Record<string, unknown>;
}

export interface Relation {
  id: string;
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
