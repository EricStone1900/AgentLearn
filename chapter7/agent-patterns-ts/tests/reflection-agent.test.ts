import { describe, expect, it } from "vitest";
import { ReflectionAgent } from "../src/agents/reflection/reflection-agent.js";
import { FakeLlmClient } from "./helpers/fake-llm.js";

describe("ReflectionAgent", () => {
  it("初稿通过评审后直接停止", async () => {
    const llm = new FakeLlmClient([
      /*
       * 第1次调用：生成初稿。
       */
      "def find_primes(n):\n    return []",

      /*
       * 第2次调用：评审初稿。
       */
      JSON.stringify({
        needsImprovement: false,
        feedback: "当前代码已经满足要求，无需改进。",
      }),
    ]);

    const agent = new ReflectionAgent({
      name: "Reflection 助手",
      llm,
      maxIterations: 3,
    });

    const result = await agent.run("编写一个测试函数");

    expect(result).toEqual({
      answer: "def find_primes(n):\n    return []",
      steps: 1,
    });

    expect(llm.calls).toHaveLength(2);
  });

  it("能够根据反馈优化，并再次进行评审", async () => {
    const initialCode = [
      "def find_primes(n):",
      "    return [x for x in range(2, n + 1)]",
    ].join("\n");

    const refinedCode = [
      "def find_primes(n):",
      "    if n < 2:",
      "        return []",
      "    return [2]",
    ].join("\n");

    const llm = new FakeLlmClient([
      /*
       * 第1次调用：生成初稿。
       */
      initialCode,

      /*
       * 第2次调用：第一轮反思。
       */
      JSON.stringify({
        needsImprovement: true,
        feedback: "当前代码没有判断数字是否为素数。",
      }),

      /*
       * 第3次调用：根据第一轮反馈优化。
       */
      refinedCode,

      /*
       * 第4次调用：第二轮反思。
       */
      JSON.stringify({
        needsImprovement: false,
        feedback: "修改后的代码满足当前测试要求。",
      }),
    ]);

    const agent = new ReflectionAgent({
      name: "Reflection 助手",
      llm,
      maxIterations: 3,
    });

    const result = await agent.run("编写一个函数，返回指定范围内的素数");

    expect(result).toEqual({
      answer: refinedCode,
      steps: 2,
    });

    expect(llm.calls).toHaveLength(4);

    /*
     * 第3次调用是优化调用。
     */
    const refinementMessages = llm.calls[2] ?? [];

    const refinementSystemMessage =
      refinementMessages.find((message) => message.role === "system")
        ?.content ?? "";

    const refinementUserMessage =
      refinementMessages.find((message) => message.role === "user")?.content ??
      "";

    // expect(refinementSystemMessage).toContain("任务优化助手");

    // expect(refinementUserMessage).toContain(initialCode);

    // expect(refinementUserMessage).toContain("解决评审指出的问题");

    // expect(refinementUserMessage).toContain("历史执行与反思轨迹");
    expect(refinementSystemMessage).toContain("任务优化助手");

    expect(refinementSystemMessage).toContain("解决评审指出的问题");

    expect(refinementUserMessage).toContain(initialCode);

    expect(refinementUserMessage).toContain("当前代码没有判断数字是否为素数");

    expect(refinementUserMessage).toContain("历史执行与反思轨迹");
  });

  it("达到最大迭代次数后返回最后一个版本", async () => {
    const llm = new FakeLlmClient([
      /*
       * 初稿。
       */
      "第一版代码",

      /*
       * 第一轮反思。
       */
      JSON.stringify({
        needsImprovement: true,
        feedback: "进行第一次优化",
      }),

      /*
       * 第一轮优化。
       */
      "第二版代码",

      /*
       * 第二轮反思。
       */
      JSON.stringify({
        needsImprovement: true,
        feedback: "进行第二次优化",
      }),

      /*
       * 第二轮优化。
       */
      "第三版代码",
    ]);

    const agent = new ReflectionAgent({
      name: "Reflection 助手",
      llm,
      maxIterations: 2,
    });

    const result = await agent.run("测试最大迭代次数");

    expect(result).toEqual({
      answer: "第三版代码",
      steps: 2,
    });

    /*
     * 1次初稿 + 2次反思 + 2次优化。
     */
    expect(llm.calls).toHaveLength(5);
  });

  it("拒绝无法解析的反思结果", async () => {
    const llm = new FakeLlmClient(["第一版代码", "这个代码还需要继续改进"]);

    const agent = new ReflectionAgent({
      name: "Reflection 助手",
      llm,
    });
    await expect(agent.run("测试非法反思结果")).rejects.toThrow(
      "第 1 轮反思结果解析失败",
    );
  });

  it("拒绝空任务，并且不会调用 LLM", async () => {
    const llm = new FakeLlmClient([]);

    const agent = new ReflectionAgent({
      name: "Reflection 助手",
      llm,
    });
    await expect(agent.run("   ")).rejects.toThrow("Reflection 任务不能为空");

    expect(llm.calls).toHaveLength(0);
  });
});
