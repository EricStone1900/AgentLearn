import { describe, expect, it } from "vitest";
import { PlanAndSolveAgent } from "../src/agents/plan-and-solve/plan-and-solve-agent.js";
import { FakeLlmClient } from "./helpers/fake-llm.js";

describe("PlanAndSolveAgent", () => {
  it("能够先规划再执行", async () => {
    const llm = new FakeLlmClient([
      /*
       * 第1次调用：Planner
       */
      JSON.stringify({
        steps: [
          "确定周一销量",
          "计算周二销量",
          "计算周三销量",
          "计算三天总销量",
        ],
      }),

      /*
       * 第2次调用：执行步骤1
       */
      "15",

      /*
       * 第3次调用：执行步骤2
       */
      "30",

      /*
       * 第4次调用：执行步骤3
       */
      "25",

      /*
       * 第5次调用：执行步骤4
       */
      "70",
    ]);

    const agent = new PlanAndSolveAgent({
      name: "Plan-and-Solve 助手",
      llm,
    });

    const result = await agent.run(
      [
        "一个水果店周一卖出了15个苹果。",
        "周二卖出的数量是周一的两倍。",
        "周三卖出的数量比周二少5个。",
        "请问三天总共卖出了多少个苹果？",
      ].join(""),
    );

    expect(result).toEqual({
      answer: "70",
      steps: 4,
    });

    /*
     * 1次规划 + 4次执行
     */
    expect(llm.calls).toHaveLength(5);
  });

  it("执行调用出现在规划调用之后", async () => {
    const llm = new FakeLlmClient([
      JSON.stringify({
        steps: ["执行第一步", "执行第二步"],
      }),
      "结果1",
      "最终结果",
    ]);

    const agent = new PlanAndSolveAgent({
      name: "Plan-and-Solve 助手",
      llm,
    });

    await agent.run("测试问题");

    const plannerSystemMessage =
      llm.calls[0]?.find((message) => message.role === "system")?.content ?? "";

    const executorSystemMessage =
      llm.calls[1]?.find((message) => message.role === "system")?.content ?? "";

    expect(plannerSystemMessage).toContain("任务规划专家");

    expect(executorSystemMessage).toContain("任务执行专家");
  });
});
