import { describe, expect, it } from "vitest";

import { Message } from "../src/core/message.js";

describe("Message", () => {
  it("能够创建消息并自动生成时间戳", () => {
    const message = new Message("你好", "user");

    expect(message.content).toBe("你好");
    expect(message.role).toBe("user");
    expect(message.timestamp).toBeInstanceOf(Date);
  });

  it("能够转换为 LLM 消息格式", () => {
    const message = new Message("你好", "user", {
      metadata: {
        userId: "user-001",
      },
    });

    expect(message.toDict()).toEqual({
      role: "user",
      content: "你好",
    });
  });

  it("能够转换成可读字符串", () => {
    const message = new Message("任务完成", "assistant");

    expect(message.toString()).toBe("[assistant] 任务完成");
  });

  it("能够保存元数据", () => {
    const message = new Message("搜索结果", "tool", {
      metadata: {
        toolName: "search",
      },
    });

    expect(message.metadata.toolName).toBe("search");
  });

  it("拒绝非法消息角色", () => {
    expect(() => {
      new Message("测试", "invalid" as never);
    }).toThrow();
  });
});
