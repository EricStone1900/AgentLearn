// export class SemanticMemory extends BaseMemory {
//   public readonly type = "semantic" as const;

//   public constructor(
//     private readonly documents: DocumentStore,
//     private readonly vectors: VectorStore,
//     private readonly graph: GraphStore,
//     private readonly embeddings: EmbeddingClient,
//     private readonly extractor: KnowledgeExtractor,
//   ) {
//     super();
//   }

//   public async add(item: MemoryItem): Promise<string> {
//     // TODO:
//     // 1. 写入文档存储
//     // 2. 生成并写入向量
//     // 3. 提取实体和关系
//     // 4. 写入图存储
//     // 5. 保存实体ID到 metadata
//     throw new Error("TODO");
//   }

//   public async retrieve(
//     query: string,
//     options = {},
//   ): Promise<MemorySearchResult[]> {
//     // TODO:
//     // 1. 向量检索
//     // 2. 从 query 提取实体
//     // 3. 图检索
//     // 4. 按 memoryId 合并两类结果
//     // 5. 计算：
//     //    (vector * 0.7 + graph * 0.3) * importanceWeight
//     // 6. 去重、排序、截取
//     throw new Error("TODO");
//   }
// }
