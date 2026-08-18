// export const modalitySchema = z.enum(["text", "image", "audio", "video"]);

// export type Modality = z.infer<typeof modalitySchema>;

// export class PerceptualMemory extends BaseMemory {
//   public readonly type = "perceptual" as const;

//   public async add(item: MemoryItem): Promise<string> {
//     // TODO:
//     // 1. 验证 metadata.modality
//     // 2. 文档库存描述和资源信息
//     // 3. 选择对应的模态编码器
//     // 4. 写入对应的向量集合
//     throw new Error("TODO");
//   }

//   public async retrieve(
//     query: string,
//     options = {},
//   ): Promise<MemorySearchResult[]> {
//     // TODO:
//     // 1. 确定 queryModality 和 targetModality
//     // 2. 获取相应编码器和向量库
//     // 3. 同模态向量检索
//     // 4. 融合时间与重要性
//     throw new Error("TODO");
//   }
// }
