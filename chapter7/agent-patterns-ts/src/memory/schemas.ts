import { z } from "zod";

export const memoryTypeSchema = z.enum([
  "working",
  "episodic",
  "semantic",
  "perceptual",
]);

export type MemoryType = z.infer<typeof memoryTypeSchema>;

export const memoryItemSchema = z.object({
  id: z.string().trim().min(1),
  content: z.string().trim().min(1),
  memoryType: memoryTypeSchema,
  userId: z.string().trim().min(1),
  timestamp: z.string().datetime(),
  importance: z.number().min(0).max(1),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export type MemoryItem = z.infer<typeof memoryItemSchema>;

export interface MemoryScoreSignals {
  relevance: number;
  importance: number;
  lexical?: number;
  vector?: number;
  graph?: number;
  recency?: number;
}

export interface MemorySearchResult {
  item: MemoryItem;
  score: number;
  signals: MemoryScoreSignals;
}

export const memoryConfigSchema = z.object({
  workingMemoryCapacity: z.number().int().positive().default(10),
  workingMemoryTtlMs: z
    .number()
    .int()
    .positive()
    .default(2 * 60 * 60 * 1000),
  longTermMemoryCapacity: z.number().int().positive().default(1000),
  defaultSearchLimit: z.number().int().positive().max(100).default(5),
  importanceThreshold: z.number().min(0).max(1).default(0.1),
  decayFactor: z.number().positive().max(1).default(0.95),
});

export type MemoryConfig = z.infer<typeof memoryConfigSchema>;

export function createDefaultMemoryConfig(): MemoryConfig {
  return memoryConfigSchema.parse({});
}

export const addMemoryInputSchema = z.object({
  content: z.string().trim().min(1),
  memoryType: memoryTypeSchema.optional(),
  importance: z.number().min(0).max(1).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  autoClassify: z.boolean().default(true),
});

export type AddMemoryInput = z.input<typeof addMemoryInputSchema>;

export const retrieveMemoriesInputSchema = z.object({
  query: z.string().trim().min(1),
  memoryTypes: z.array(memoryTypeSchema).min(1).optional(),
  limit: z.number().int().positive().max(100).optional(),
  minImportance: z.number().min(0).max(1).optional(),
  startTime: z.string().datetime().optional(),
  endTime: z.string().datetime().optional(),
});

export type RetrieveMemoriesInput = z.input<typeof retrieveMemoriesInputSchema>;

export const forgetStrategySchema = z.enum([
  "importance_based",
  "time_based",
  "capacity_based",
]);

export type ForgetStrategy = z.infer<typeof forgetStrategySchema>;

export const consolidateMemoryInputSchema = z
  .object({
    fromType: memoryTypeSchema,
    toType: memoryTypeSchema,
    importanceThreshold: z.number().min(0).max(1),
  })
  .refine((input) => input.fromType !== input.toType, {
    message: "源记忆类型和目标记忆类型不能相同",
    path: ["toType"],
  });

export type ConsolidateMemoryInput = z.infer<
  typeof consolidateMemoryInputSchema
>;
