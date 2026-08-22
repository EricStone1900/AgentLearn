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
import {
  DocumentQa,
} from "../../src/components/document-qa.js";
import type {
  AssistantApi,
} from "../../src/api/assistant-api.js";
import type {
  CurrentDocument,
} from "../../src/api/contracts.js";

const currentDocument: CurrentDocument = {
  documentId: "doc-1",
  title: "RAG 学习指南",
  source: "rag-guide.pdf",
  pageCount: 3,
  chunkCount: 8,
  loadedAt: "2026-08-22T00:00:00.000Z",
};

function createApi(): Pick<AssistantApi, "askDocument"> {
  return {
    askDocument: vi.fn<AssistantApi["askDocument"]>(),
  };
}

describe("DocumentQa", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("未上传文档时禁用提问", () => {
    render(<DocumentQa api={createApi()} />);

    expect((screen.getByLabelText("你的问题") as HTMLTextAreaElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "开始问答" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("请先上传并加载一份 PDF 文档。")).not.toBeNull();
  });

  it("提问后展示回答与引用来源", async () => {
    const api = createApi();

    (api.askDocument as MockedFunction<AssistantApi["askDocument"]>).mockResolvedValue({
      question: "什么是 RAG？",
      answer: "RAG 会先检索相关文档片段，再基于片段生成回答。",
      citations: [
        {
          index: 1,
          documentId: "doc-1",
          source: "rag-guide.pdf",
          startOffset: 0,
          endOffset: 50,
          score: 0.8765,
        },
      ],
      warnings: ["写入学习记忆失败"],
    });

    render(<DocumentQa api={api} currentDocument={currentDocument} />);

    fireEvent.change(screen.getByLabelText("你的问题"), {
      target: { value: "什么是 RAG？" },
    });
    fireEvent.click(screen.getByRole("button", { name: "开始问答" }));

    await waitFor(() => {
      expect(api.askDocument).toHaveBeenCalledWith(
        {
          question: "什么是 RAG？",
          scope: "current_document",
          useAdvancedSearch: true,
        },
        expect.any(AbortSignal),
      );
    });

    expect(await screen.findByText("RAG 会先检索相关文档片段，再基于片段生成回答。")).not.toBeNull();
    expect(screen.getByText("rag-guide.pdf")).not.toBeNull();
    expect(screen.getByText("片段 #1 · 相关度 0.876")).not.toBeNull();
    expect(screen.getByText("写入学习记忆失败")).not.toBeNull();
  });

  it("展示后端提供的可追踪错误信息", async () => {
    const api = createApi();

    (api.askDocument as MockedFunction<AssistantApi["askDocument"]>).mockRejectedValue(
      new Error("请先上传并加载 PDF 文档"),
    );

    render(<DocumentQa api={api} currentDocument={currentDocument} />);

    fireEvent.change(screen.getByLabelText("你的问题"), {
      target: { value: "文档讲了什么？" },
    });
    fireEvent.click(screen.getByRole("button", { name: "开始问答" }));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "请先上传并加载 PDF 文档",
    );
  });
});
