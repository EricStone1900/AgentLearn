// import { BaseMemory } from "../base.js";

// export class EpisodicMemory extends BaseMemory {
//   public readonly type = "episodic" as const;

//   public constructor(
//     private readonly documents: DocumentStore,
//     private readonly vectors: VectorStore,
//     private readonly embeddings: EmbeddingClient,
//   ) {
//     super();
//   }

//   public async add(item: MemoryItem): Promise<string> {
//     // TODO:
//     // 1. 验证 memoryType
//     // 2. 写入 DocumentStore
//     // 3. 对 content 生成 embedding
//     // 4. 将向量和必要元数据写入 VectorStore
//     // 5. 如果步骤 3/4 失败，考虑回滚文档存储
//     throw new Error("TODO");
//   }

//   public async retrieve(
//     query: string,
//     options = {},
//   ): Promise<MemorySearchResult[]> {
//     // TODO:
//     // 1. 对查询生成向量
//     // 2. 根据 userId 和 memoryType 搜索候选
//     // 3. 从 DocumentStore 获取完整数据
//     // 4. 应用时间范围、importance 等结构化过滤
//     // 5. 计算：
//     //    (vector * 0.8 + recency * 0.2) * importanceWeight
//     // 6. 排序并截取 limit
//     throw new Error("TODO");
//   }

//   public async getTimeline(userId: string, limit = 50): Promise<MemoryItem[]> {
//     // TODO: 按 timestamp 降序获取事件
//     throw new Error("TODO");
//   }

//   public async getSessionEpisodes(
//     userId: string,
//     sessionId: string,
//   ): Promise<MemoryItem[]> {
//     // TODO: 根据 metadata.sessionId 过滤
//     throw new Error("TODO");
//   }
// }
