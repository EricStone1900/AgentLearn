import { describe, expect, it } from "vitest";
import { Executor } from "../src/agents/plan-and-solve/executor.js";
import { FakeLlmClient } from "./helpers/fake-llm.js";

describe("Executor", () => {
  it("能够按顺序执行完整计划", async () => {
    const llm = new FakeLlmClient(["30", "25", "70"]);

    const executor = new Executor(llm);

    const plan = [
      "计算周二卖出的苹果数量",
      "计算周三卖出的苹果数量",
      "计算三天总销量",
    ];

    const result = await executor.execute(
      [
        "水果店周一卖出15个苹果。",
        "周二销量是周一两倍。",
        "周三比周二少5个。",
        "计算三天总销量。",
      ].join(""),
      plan,
    );

    expect(result.finalAnswer).toBe("70");

    expect(result.history).toEqual([
      {
        stepNumber: 1,
        step: "计算周二卖出的苹果数量",
        result: "30",
      },
      {
        stepNumber: 2,
        step: "计算周三卖出的苹果数量",
        result: "25",
      },
      {
        stepNumber: 3,
        step: "计算三天总销量",
        result: "70",
      },
    ]);

    expect(llm.calls).toHaveLength(3);
  });

  it("后续步骤可以看到前面步骤的结果", async () => {
    const llm = new FakeLlmClient(["30", "25"]);

    const executor = new Executor(llm);

    await executor.execute("测试问题", [
      "计算第一步结果",
      "使用第一步结果完成第二步",
    ]);

    const secondCallUserMessage =
      llm.calls[1]?.find((message) => message.role === "user")?.content ?? "";

    expect(secondCallUserMessage).toContain("步骤 1: 计算第一步结果");

    expect(secondCallUserMessage).toContain("结果: 30");
  });

  it("拒绝空计划", async () => {
    const llm = new FakeLlmClient([]);

    const executor = new Executor(llm);

    await expect(executor.execute("测试问题", [])).rejects.toThrow(
      "执行计划不能为空",
    );

    expect(llm.calls).toHaveLength(0);
  });

  it("拒绝空问题", async () => {
    const llm = new FakeLlmClient([]);

    const executor = new Executor(llm);

    await expect(executor.execute("   ", ["测试步骤"])).rejects.toThrow(
      "执行问题不能为空",
    );

    expect(llm.calls).toHaveLength(0);
  });
});
