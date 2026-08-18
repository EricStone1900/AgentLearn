// export interface AddMemoryInput {
//   content: string;
//   memoryType?: MemoryType;
//   importance?: number;
//   metadata?: Record<string, unknown>;
//   autoClassify?: boolean;
// }

// export interface RetrieveMemoriesInput {
//   query: string;
//   memoryTypes?: MemoryType[];
//   limit?: number;
//   minImportance?: number;
//   startTime?: string;
//   endTime?: string;
// }

// import { randomUUID } from "node:crypto";

// export class MemoryManager {
//   private readonly memories = new Map<MemoryType, BaseMemory>();

//   public constructor(
//     private readonly userId: string,
//     memoryImplementations: BaseMemory[],
//   ) {
//     // TODO:
//     // 1. 验证 userId
//     // 2. 按 type 注册 Memory
//     // 3. 禁止重复类型
//   }

//   public async addMemory(input: AddMemoryInput): Promise<string> {
//     // TODO:
//     // 1. trim 并检查 content
//     // 2. 决定 memoryType
//     // 3. 决定 importance
//     // 4. 创建 MemoryItem
//     // 5. 找到目标 Memory
//     // 6. 调用 add
//     throw new Error("TODO");
//   }

//   public async retrieveMemories(
//     input: RetrieveMemoriesInput,
//   ): Promise<MemorySearchResult[]> {
//     // TODO:
//     // 1. 决定需要搜索的记忆类型
//     // 2. 并行检索各类型
//     // 3. 合并结果
//     // 4. 按 memory.id 去重
//     // 5. 按 result.score 排序
//     // 6. 截取全局 limit
//     throw new Error("TODO");
//   }

//   public async updateMemory(
//     memoryId: string,
//     input: UpdateMemoryInput,
//   ): Promise<boolean> {
//     // TODO: 逐个 Memory 调用 has，找到后更新
//     throw new Error("TODO");
//   }

//   public async removeMemory(memoryId: string): Promise<boolean> {
//     // TODO
//     throw new Error("TODO");
//   }
// }
