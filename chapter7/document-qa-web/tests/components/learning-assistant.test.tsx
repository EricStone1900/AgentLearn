// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  afterEach,
  describe,
  expect,
  it,
  vi,
  type MockedFunction,
} from "vitest";
import type {
  AssistantApi,
} from "../../src/api/assistant-api.js";
import {
  LearningAssistant,
} from "../../src/components/learning-assistant.js";

function createApi(): Pick<AssistantApi, "chat" | "addNote"> {
  return {
    chat: vi.fn<AssistantApi["chat"]>(),
    addNote: vi.fn<AssistantApi["addNote"]>(),
  };
}

describe("LearningAssistant", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("发送追问并展示学习助手回答", async () => {
    const api = createApi();
    (api.chat as MockedFunction<AssistantApi["chat"]>).mockResolvedValue({
      answer: "建议先理解检索、重排和生成三个环节。",
      steps: 3,
    });

    render(<LearningAssistant {...api} />);

    fireEvent.change(screen.getByLabelText("追问"), {
      target: { value: "我应该如何学习 RAG？" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送给学习助手" }));

    await waitFor(() => {
      expect(api.chat).toHaveBeenCalledWith(
        {
          message: "我应该如何学习 RAG？",
        },
        expect.any(AbortSignal),
      );
    });

    expect(await screen.findByText("建议先理解检索、重排和生成三个环节。")).not.toBeNull();
    expect(screen.getByText("Agent 步数：3")).not.toBeNull();
  });

  it("保存笔记时提交可选概念并展示记忆 ID", async () => {
    const api = createApi();
    (api.addNote as MockedFunction<AssistantApi["addNote"]>).mockResolvedValue({
      memoryId: "memory-1",
    });

    render(<LearningAssistant {...api} />);

    fireEvent.change(screen.getByLabelText("笔记内容"), {
      target: { value: "RAG 的答案应该保留来源。" },
    });
    fireEvent.change(screen.getByLabelText("关联概念（可选）"), {
      target: { value: "RAG" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存到学习记忆" }));

    await waitFor(() => {
      expect(api.addNote).toHaveBeenCalledWith(
        {
          content: "RAG 的答案应该保留来源。",
          concept: "RAG",
        },
        expect.any(AbortSignal),
      );
    });

    expect(await screen.findByText("笔记已保存（记忆 ID：memory-1）。")).not.toBeNull();
  });
});
