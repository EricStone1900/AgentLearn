import { describe, expect, it } from "vitest";
import {
  addMemoryInputSchema,
  createDefaultMemoryConfig,
  memoryItemSchema,
} from "../src/memory/schemas.js";

describe("memory schemas", () => {
  it("解析合法记忆", () => {
    const item = memoryItemSchema.parse({
      id: "m-1",
      content: "  用户正在学习 TypeScript  ",
      memoryType: "semantic",
      userId: "u-1",
      timestamp: "2026-08-18T10:00:00.000Z",
      importance: 0.8,
    });

    expect(item.content).toBe("用户正在学习 TypeScript");
    expect(item.metadata).toEqual({});
  });

  it("拒绝越界的重要性", () => {
    const result = addMemoryInputSchema.safeParse({
      content: "测试",
      importance: 2,
    });

    expect(result.success).toBe(false);
  });

  it("生成默认配置", () => {
    expect(createDefaultMemoryConfig().workingMemoryCapacity).toBe(10);
  });
});
