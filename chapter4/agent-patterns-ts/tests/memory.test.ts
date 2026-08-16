import { describe, expect, it } from "vitest";
import { ShortTermMemory } from "../src/agents/reflection/memory.js";

describe("ShortTermMemory", () => {
  it("没有执行记录时返回 undefined", () => {
    const memory = new ShortTermMemory();

    expect(memory.latestExecution()).toBeUndefined();
  });

  it("能够获取最近一次执行结果", () => {
    const memory = new ShortTermMemory();

    memory.add({
      kind: "execution",
      content: "第一版代码",
    });

    memory.add({
      kind: "reflection",
      content: "第一版代码需要优化",
    });

    memory.add({
      kind: "execution",
      content: "第二版代码",
    });

    expect(memory.latestExecution()).toBe("第二版代码");
  });

  it("能够按照正确顺序生成完整轨迹", () => {
    const memory = new ShortTermMemory();

    memory.add({
      kind: "execution",
      content: "第一版代码",
    });

    memory.add({
      kind: "reflection",
      content: "建议降低时间复杂度",
    });

    memory.add({
      kind: "execution",
      content: "第二版代码",
    });

    const trajectory = memory.trajectory();

    expect(trajectory).toContain("第 1 版执行结果");
    expect(trajectory).toContain("第一版代码");

    expect(trajectory).toContain("第 1 轮反思反馈");
    expect(trajectory).toContain("建议降低时间复杂度");

    expect(trajectory).toContain("第 2 版执行结果");
    expect(trajectory).toContain("第二版代码");
  });

  it("拒绝添加空内容", () => {
    const memory = new ShortTermMemory();

    expect(() => {
      memory.add({
        kind: "execution",
        content: "   ",
      });
    }).toThrow("不能向记忆中添加空内容");
  });
});
