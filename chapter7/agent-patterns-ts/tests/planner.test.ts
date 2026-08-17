import { describe, expect, it } from "vitest";
import { Planner } from "../src/agents/plan-and-solve/planner.js";
import { FakeLlmClient } from "./helpers/fake-llm.js";

describe("Planner", () => {
  it("可以把模型返回的 JSON 解析成计划", async () => {
    const llm = new FakeLlmClient([
      JSON.stringify({
        steps: [
          "计算周二卖出的苹果数量",
          "计算周三卖出的苹果数量",
          "计算三天总销量",
        ],
      }),
    ]);

    const planner = new Planner(llm);

    const plan = await planner.plan("计算水果店三天的苹果总销量");

    expect(plan).toEqual([
      "计算周二卖出的苹果数量",
      "计算周三卖出的苹果数量",
      "计算三天总销量",
    ]);

    expect(llm.calls).toHaveLength(1);
  });

  it("拒绝空计划", async () => {
    const llm = new FakeLlmClient([
      JSON.stringify({
        steps: [],
      }),
    ]);

    const planner = new Planner(llm);

    await expect(planner.plan("测试问题")).rejects.toThrow(
      "无法解析 Planner 生成的计划",
    );
  });

  it("拒绝非法 JSON", async () => {
    const llm = new FakeLlmClient(["第一步：计算周二销量"]);

    const planner = new Planner(llm);

    await expect(planner.plan("测试问题")).rejects.toThrow(
      "无法解析 Planner 生成的计划",
    );
  });

  it("拒绝空问题", async () => {
    const llm = new FakeLlmClient([]);

    const planner = new Planner(llm);

    await expect(planner.plan("   ")).rejects.toThrow("规划问题不能为空");

    expect(llm.calls).toHaveLength(0);
  });
});
