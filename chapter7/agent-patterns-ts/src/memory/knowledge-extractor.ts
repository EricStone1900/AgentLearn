import { createHash, randomUUID } from "node:crypto";
import type { Entity, Relation } from "./storage/graph-store.js";

export interface KnowledgeContext {
  memoryId: string;
  userId: string;
}

export interface ExtractedKnowledge {
  entities: Entity[];
  relations: Relation[];
}

export interface KnowledgeExtractor {
  extract(
    content: string,
    context: KnowledgeContext,
  ): Promise<ExtractedKnowledge>;
}

function entityId(userId: string, name: string): string {
  return createHash("sha256")
    .update(`${userId}:${name.toLowerCase()}`)
    .digest("hex");
}

export class RuleBasedKnowledgeExtractor implements KnowledgeExtractor {
  public async extract(
    content: string,
    context: KnowledgeContext,
  ): Promise<ExtractedKnowledge> {
    const entityMap = new Map<string, Entity>();
    const relations: Relation[] = [];

    const patterns: Array<{ expression: RegExp; relation: string }> = [
      { expression: /([^，。；]+?)属于([^，。；]+)/g, relation: "BELONGS_TO" },
      { expression: /([^，。；]+?)喜欢([^，。；]+)/g, relation: "LIKES" },
      { expression: /([^，。；]+?)学习([^，。；]+)/g, relation: "LEARNS" },
      { expression: /([^，。；]+?)是(?:一种|一个)?([^，。；]+)/g, relation: "IS_A" },
    ];

    const addEntity = (rawName: string): Entity => {
      const name = rawName.trim();
      const id = entityId(context.userId, name);
      const existing = entityMap.get(id);
      if (existing) return existing;

      const entity: Entity = {
        id,
        userId: context.userId,
        name,
        type: "concept",
        properties: {},
      };
      entityMap.set(id, entity);
      return entity;
    };

    for (const pattern of patterns) {
      for (const match of content.matchAll(pattern.expression)) {
        const sourceName = match[1]?.trim();
        const targetName = match[2]?.trim();
        if (!sourceName || !targetName) continue;

        const source = addEntity(sourceName);
        const target = addEntity(targetName);

        relations.push({
          id: randomUUID(),
          userId: context.userId,
          sourceId: source.id,
          targetId: target.id,
          type: pattern.relation,
          memoryId: context.memoryId,
          properties: {},
        });
      }
    }

    // 查询文本不一定包含明确关系，补充英文术语实体用于图检索。
    for (const token of content.match(/[A-Za-z][A-Za-z0-9_+-]{1,}/g) ?? []) {
      addEntity(token);
    }

    return {
      entities: [...entityMap.values()],
      relations,
    };
  }
}