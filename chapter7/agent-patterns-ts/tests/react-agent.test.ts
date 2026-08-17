import { describe, expect, it } from "vitest";
import { ReActAgent } from "../src/agents/react/react-agent.js";
import { calculatorTool } from "../src/tools/calculator.js";
import { ToolRegistry } from "../src/tools/tool.js";
import { FakeLlmClient } from "./helpers/fake-llm.js";

describe("ReActAgent", () => {
  it("能够调用工具并根据 Observation 完成任务", async () => {
    const llm = new FakeLlmClient([
      JSON.stringify({
        type: "tool",
        thought: "需要使用计算器计算 2 + 3",
        tool: "calculator",
        input: {
          left: 2,
          operator: "+",
          right: 3,
        },
      }),

      JSON.stringify({
        type: "finish",
        thought: "已经从 Observation 得到结果",
        answer: "2 + 3 = 5",
      }),
    ]);

    const tools = new ToolRegistry();
    tools.register(calculatorTool);

    const agent = new ReActAgent({
      name: "ReAct 助手",
      llm,
      tools,
      maxSteps: 3,
    });

    const result = await agent.run("计算 2 + 3");

    expect(result.answer).toBe("2 + 3 = 5");
    expect(result.steps).toBe(2);
    expect(llm.calls).toHaveLength(2);

    const secondCallUserMessage =
      llm.calls[1]?.find((message) => message.role === "user")?.content ?? "";

    expect(secondCallUserMessage).toContain("Observation: 5");
  });

  it("达到最大步骤数时会终止", async () => {
    const repeatedToolCall = JSON.stringify({
      type: "tool",
      thought: "继续重复计算",
      tool: "calculator",
      input: {
        left: 2,
        operator: "+",
        right: 3,
      },
    });

    const llm = new FakeLlmClient([repeatedToolCall, repeatedToolCall]);

    const tools = new ToolRegistry();
    tools.register(calculatorTool);

    const agent = new ReActAgent({
      name: "ReAct 助手",
      llm,
      tools,
      maxSteps: 2,
    });

    await expect(agent.run("计算 2 + 3")).rejects.toThrow("达到最大步骤数");
  });

  it("模型第一次返回非法格式时可以在下一轮纠正", async () => {
    const llm = new FakeLlmClient([
      "我认为答案可能是 5",

      JSON.stringify({
        type: "finish",
        thought: "上一轮格式错误，本轮改用 JSON",
        answer: "答案是 5",
      }),
    ]);

    const tools = new ToolRegistry();
    tools.register(calculatorTool);

    const agent = new ReActAgent({
      name: "ReAct 助手",
      llm,
      tools,
      maxSteps: 3,
    });

    const result = await agent.run("计算 2 + 3");

    expect(result.answer).toBe("答案是 5");
    expect(result.steps).toBe(2);

    const secondCallUserMessage =
      llm.calls[1]?.find((message) => message.role === "user")?.content ?? "";

    expect(secondCallUserMessage).toContain("输出格式不合法");
  });
});
