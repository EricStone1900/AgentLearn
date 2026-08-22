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
  LearningReport,
} from "../../src/components/learning-report.js";

describe("LearningReport", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("生成仅在页面展示的学习报告", async () => {
    const generateReport: MockedFunction<AssistantApi["generateReport"]> =
      vi.fn<AssistantApi["generateReport"]>();

    generateReport.mockResolvedValue({
      report: {
        schemaVersion: 1,
        generatedAt: "2026-08-22T00:00:00.000Z",
        session: {
          sessionId: "session-1",
          userId: "user-1",
          namespace: "document-qa:user-1",
          startedAt: "2026-08-22T00:00:00.000Z",
          durationSeconds: 120,
        },
        metrics: {
          documentsLoaded: 1,
          questionsAsked: 2,
          notesAdded: 1,
          agentInteractions: 3,
        },
        currentDocument: {
          documentId: "doc-1",
          title: "RAG Guide",
          source: "rag-guide.pdf",
          pageCount: 2,
          chunkCount: 4,
          loadedAt: "2026-08-22T00:00:00.000Z",
        },
        rag: {
          documents: 1,
          chunks: 4,
        },
        memory: {
          userId: "user-1",
          totalMemories: 1,
          memoriesByType: {},
        },
        memorySummary: [{
          id: "memory-1",
          content: "RAG 的回答应该保留引用来源。",
          memoryType: "semantic",
          userId: "user-1",
          timestamp: "2026-08-22T00:00:00.000Z",
          importance: 0.8,
          metadata: {},
        }],
      },
    });

    render(<LearningReport api={{ generateReport }} />);

    fireEvent.change(screen.getByLabelText("报告中保留的记忆条数"), {
      target: { value: "5" },
    });
    fireEvent.click(screen.getByRole("button", { name: "生成学习报告" }));

    await waitFor(() => {
      expect(generateReport).toHaveBeenCalledWith(
        {
          saveToFile: false,
          memorySummaryLimit: 5,
        },
        expect.any(AbortSignal),
      );
    });

    expect(await screen.findByText("本次学习文档：RAG Guide")).not.toBeNull();
    expect(screen.getByText("RAG 的回答应该保留引用来源。")).not.toBeNull();
    expect(screen.queryByText(/reportFile/)).toBeNull();
  });
});
