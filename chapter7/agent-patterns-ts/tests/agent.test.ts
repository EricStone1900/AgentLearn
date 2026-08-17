import { describe, expect, it } from "vitest";

import { Agent, type AgentOptions } from "../src/core/agent.js";
import { Message } from "../src/core/message.js";
import type { AgentResult } from "../src/core/types.js";
import { FakeLlmClient } from "./helpers/fake-llm.js";

class TestAgent extends Agent {
  public constructor(options: AgentOptions) {
    super(options);
  }

  public async run(inputText: string): Promise<AgentResult> {
    const messages = this.buildBaseMessages();

    messages.push({
      role: "user",
      content: inputText,
    });

    const answer = await this.llm.generate(messages, 0);

    this.addMessage(new Message(inputText, "user"));

    this.addMessage(new Message(answer, "assistant"));

    return {
      answer,
      steps: 1,
    };
  }
}

describe("Agent", () => {
  it("子类能够实现统一的 run 接口", async () => {
    const llm = new FakeLlmClient(["你好，我是测试助手。"]);

    const agent = new TestAgent({
      name: "测试助手",
      llm,
      systemPrompt: "你是一个友好的助手。",
    });

    const result = await agent.run("你好");

    expect(result).toEqual({
      answer: "你好，我是测试助手。",
      steps: 1,
    });
  });

  it("能够保存对话历史", async () => {
    const llm = new FakeLlmClient(["测试回答"]);

    const agent = new TestAgent({
      name: "测试助手",
      llm,
    });

    await agent.run("测试问题");

    const history = agent.getHistory();

    expect(history).toHaveLength(2);
    expect(history[0]?.role).toBe("user");
    expect(history[1]?.role).toBe("assistant");
  });

  it("getHistory 返回数组副本", async () => {
    const llm = new FakeLlmClient(["测试回答"]);

    const agent = new TestAgent({
      name: "测试助手",
      llm,
    });

    await agent.run("测试问题");

    const copiedHistory = agent.getHistory();

    copiedHistory.length = 0;

    expect(agent.getHistory()).toHaveLength(2);
  });

  it("能够清空历史记录", async () => {
    const llm = new FakeLlmClient(["测试回答"]);

    const agent = new TestAgent({
      name: "测试助手",
      llm,
    });

    await agent.run("测试问题");
    agent.clearHistory();

    expect(agent.getHistory()).toHaveLength(0);
  });

  it("能够生成可读描述", () => {
    const llm = {
      provider: "fake",
      async generate(): Promise<string> {
        return "测试回答";
      },
    };

    const agent = new TestAgent({
      name: "测试助手",
      llm,
    });

    expect(agent.toString()).toBe("Agent(name=测试助手, provider=fake)");
  });

  it("拒绝空 Agent 名称", () => {
    const llm = new FakeLlmClient([]);

    expect(() => {
      new TestAgent({
        name: "   ",
        llm,
      });
    }).toThrow("Agent 名称不能为空");
  });
});
