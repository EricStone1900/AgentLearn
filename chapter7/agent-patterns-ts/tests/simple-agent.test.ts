import { describe, expect, it } from "vitest";

import { SimpleAgent } from "../src/agents/simple/simple-agent.js";
import { calculatorTool } from "../src/tools/calculator.js";
import { ToolRegistry } from "../src/tools/tool.js";
import { FakeLlmClient } from "./helpers/fake-llm.js";

describe("SimpleAgent", () => {
  it("能够完成普通对话并保存历史", async () => {
    const llm = new FakeLlmClient(["你好，我是测试助手。"]);

    const agent = new SimpleAgent({
      name: "简单助手",
      llm,
      systemPrompt: "你是一个友好的助手。",
      enableToolCalling: false,
    });

    const result = await agent.run("你好");

    expect(result.answer).toBe("你好，我是测试助手。");
    expect(result.steps).toBe(1);
    expect(agent.getHistory()).toHaveLength(2);
  });

  it("能够执行文本协议工具调用", async () => {
    const llm = new FakeLlmClient([
      '[TOOL_CALL:calculator:{"left":15,"operator":"*","right":8}]',
      "15 乘以 8 的结果是 120。",
    ]);

    const tools = new ToolRegistry();
    tools.register(calculatorTool);

    const agent = new SimpleAgent({
      name: "工具助手",
      llm,
      toolRegistry: tools,
      maxToolIterations: 3,
    });

    const result = await agent.run("计算 15 * 8");

    expect(result.answer).toContain("120");
    expect(result.steps).toBe(2);

    const secondCall = llm.calls[1] ?? [];

    expect(
      secondCall.some(
        (message) =>
          message.role === "user" && message.content.includes("执行结果：120"),
      ),
    ).toBe(true);
  });
});
