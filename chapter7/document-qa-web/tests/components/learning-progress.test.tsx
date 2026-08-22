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
  LearningProgress,
} from "../../src/components/learning-progress.js";

function createApi(): Pick<AssistantApi, "getStats" | "searchMemories"> {
  return {
    getStats: vi.fn<AssistantApi["getStats"]>(),
    searchMemories: vi.fn<AssistantApi["searchMemories"]>(),
  };
}

describe("LearningProgress", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("加载并展示当前学习会话统计", async () => {
    const api = createApi();
    (api.getStats as MockedFunction<AssistantApi["getStats"]>).mockResolvedValue({
      sessionId: "session-1",
      userId: "user-1",
      namespace: "document-qa:user-1",
      sessionStartedAt: "2026-08-22T00:00:00.000Z",
      durationSeconds: 30,
      currentDocument: {
        documentId: "doc-1",
        title: "RAG Guide",
        source: "rag-guide.pdf",
        pageCount: 2,
        chunkCount: 4,
        loadedAt: "2026-08-22T00:00:00.000Z",
      },
      metrics: {
        documentsLoaded: 1,
        questionsAsked: 2,
        notesAdded: 3,
        agentInteractions: 4,
      },
      rag: {
        documents: 1,
        chunks: 4,
      },
      memory: {
        userId: "user-1",
        totalMemories: 3,
        memoriesByType: {},
      },
    });

    render(<LearningProgress api={api} />);

    await waitFor(() => {
      expect(api.getStats).toHaveBeenCalledWith(expect.any(AbortSignal));
    });

    expect(await screen.findByText("当前文档：RAG Guide（4 个切片）")).not.toBeNull();
    expect(screen.getByText("已保存笔记")).not.toBeNull();
    expect(screen.getAllByText("3")).toHaveLength(1);
  });

  it("检索并展示学习记忆", async () => {
    const api = createApi();
    (api.getStats as MockedFunction<AssistantApi["getStats"]>).mockResolvedValue({
      sessionId: "session-1",
      userId: "user-1",
      namespace: "document-qa:user-1",
      sessionStartedAt: "2026-08-22T00:00:00.000Z",
      durationSeconds: 30,
      metrics: { documentsLoaded: 0, questionsAsked: 0, notesAdded: 0, agentInteractions: 0 },
      rag: { documents: 0, chunks: 0 },
      memory: { userId: "user-1", totalMemories: 0, memoriesByType: {} },
    });
    (api.searchMemories as MockedFunction<AssistantApi["searchMemories"]>).mockResolvedValue({
      count: 1,
      results: [{
        item: {
          id: "memory-1",
          content: "RAG 需要保留引用来源。",
          memoryType: "semantic",
          userId: "user-1",
          timestamp: "2026-08-22T00:00:00.000Z",
          importance: 0.8,
          metadata: {},
        },
        score: 0.9123,
        signals: { relevance: 0.9, importance: 0.8 },
      }],
    });

    render(<LearningProgress api={api} />);

    fireEvent.change(screen.getByLabelText("检索内容"), {
      target: { value: "RAG" },
    });
    fireEvent.click(screen.getByRole("button", { name: "搜索学习记忆" }));

    await waitFor(() => {
      expect(api.searchMemories).toHaveBeenCalledWith(
        { query: "RAG", limit: 10 },
        expect.any(AbortSignal),
      );
    });

    expect(await screen.findByText("RAG 需要保留引用来源。")).not.toBeNull();
    expect(screen.getByText(/semantic · 相关度 0.912/)).not.toBeNull();
  });
});
