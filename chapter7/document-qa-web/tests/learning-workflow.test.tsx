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
  useState,
} from "react";
import type {
  AssistantApi,
} from "../src/api/assistant-api.js";
import type {
  CurrentDocument,
} from "../src/api/contracts.js";
import {
  DocumentUpload,
} from "../src/components/document-upload.js";
import {
  DocumentQa,
} from "../src/components/document-qa.js";
import {
  LearningAssistant,
} from "../src/components/learning-assistant.js";
import {
  LearningProgress,
} from "../src/components/learning-progress.js";
import {
  LearningReport,
} from "../src/components/learning-report.js";

const document: CurrentDocument = {
  documentId: "doc-1",
  title: "RAG Guide",
  source: "rag-guide.pdf",
  pageCount: 2,
  chunkCount: 4,
  loadedAt: "2026-08-22T00:00:00.000Z",
};

function createApi(): Pick<
  AssistantApi,
  | "uploadPdf"
  | "askDocument"
  | "chat"
  | "addNote"
  | "getStats"
  | "searchMemories"
  | "generateReport"
> {
  return {
    uploadPdf: vi.fn<AssistantApi["uploadPdf"]>(),
    askDocument: vi.fn<AssistantApi["askDocument"]>(),
    chat: vi.fn<AssistantApi["chat"]>(),
    addNote: vi.fn<AssistantApi["addNote"]>(),
    getStats: vi.fn<AssistantApi["getStats"]>(),
    searchMemories: vi.fn<AssistantApi["searchMemories"]>(),
    generateReport: vi.fn<AssistantApi["generateReport"]>(),
  };
}

function Workflow(props: { api: ReturnType<typeof createApi> }) {
  const [currentDocument, setCurrentDocument] = useState<CurrentDocument | undefined>(undefined);
  const [activityVersion, setActivityVersion] = useState(0);
  const refresh = () => setActivityVersion((previous) => previous + 1);

  return (
    <>
      <DocumentUpload
        api={props.api}
        maxUploadBytes={25 * 1024 * 1024}
        onUploaded={(result) => {
          setCurrentDocument(result.document);
          refresh();
        }}
      />
      <DocumentQa api={props.api} currentDocument={currentDocument} onAnswered={refresh} />
      <LearningAssistant chat={props.api.chat} addNote={props.api.addNote} onActivity={refresh} />
      <LearningProgress api={props.api} refreshKey={activityVersion} />
      <LearningReport api={props.api} />
    </>
  );
}

describe("学习工作流集成", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("完成上传、问答、笔记、检索和报告，并在活动后刷新统计", async () => {
    const api = createApi();

    (api.uploadPdf as MockedFunction<AssistantApi["uploadPdf"]>).mockResolvedValue({
      document,
      ingestion: { documentId: "doc-1", chunkCount: 4, replaced: false },
      durationMs: 20,
      warnings: [],
    });
    (api.askDocument as MockedFunction<AssistantApi["askDocument"]>).mockResolvedValue({
      question: "什么是 RAG？",
      answer: "先检索，再生成。",
      citations: [],
      warnings: [],
    });
    (api.addNote as MockedFunction<AssistantApi["addNote"]>).mockResolvedValue({
      memoryId: "memory-1",
    });
    (api.searchMemories as MockedFunction<AssistantApi["searchMemories"]>).mockResolvedValue({
      count: 1,
      results: [{
        item: {
          id: "memory-1",
          content: "RAG 要保留引用。",
          memoryType: "semantic",
          userId: "user-1",
          timestamp: "2026-08-22T00:00:00.000Z",
          importance: 0.8,
          metadata: {},
        },
        score: 0.9,
        signals: { relevance: 0.9, importance: 0.8 },
      }],
    });
    (api.getStats as MockedFunction<AssistantApi["getStats"]>).mockResolvedValue({
      sessionId: "session-1",
      userId: "user-1",
      namespace: "document-qa:user-1",
      sessionStartedAt: "2026-08-22T00:00:00.000Z",
      durationSeconds: 30,
      currentDocument: document,
      metrics: { documentsLoaded: 1, questionsAsked: 1, notesAdded: 1, agentInteractions: 0 },
      rag: { documents: 1, chunks: 4 },
      memory: { userId: "user-1", totalMemories: 1, memoriesByType: {} },
    });
    (api.generateReport as MockedFunction<AssistantApi["generateReport"]>).mockResolvedValue({
      report: {
        schemaVersion: 1,
        generatedAt: "2026-08-22T00:00:00.000Z",
        session: { sessionId: "session-1", userId: "user-1", namespace: "document-qa:user-1", startedAt: "2026-08-22T00:00:00.000Z", durationSeconds: 30 },
        metrics: { documentsLoaded: 1, questionsAsked: 1, notesAdded: 1, agentInteractions: 0 },
        currentDocument: document,
        rag: { documents: 1, chunks: 4 },
        memory: { userId: "user-1", totalMemories: 1, memoriesByType: {} },
        memorySummary: [],
      },
    });

    render(<Workflow api={api} />);

    fireEvent.change(screen.getByLabelText("选择 PDF 文件"), {
      target: { files: [new File(["%PDF-1.4"], "rag-guide.pdf", { type: "application/pdf" })] },
    });
    fireEvent.click(screen.getByRole("button", { name: "上传并加载文档" }));
    await screen.findByText("文档已加载到知识库。");

    fireEvent.change(screen.getByLabelText("你的问题"), { target: { value: "什么是 RAG？" } });
    fireEvent.click(screen.getByRole("button", { name: "开始问答" }));
    await screen.findByText("先检索，再生成。");

    fireEvent.change(screen.getByLabelText("笔记内容"), { target: { value: "RAG 要保留引用。" } });
    fireEvent.click(screen.getByRole("button", { name: "保存到学习记忆" }));
    await screen.findByText("笔记已保存（记忆 ID：memory-1）。");

    fireEvent.change(screen.getByLabelText("检索内容"), { target: { value: "RAG" } });
    fireEvent.click(screen.getByRole("button", { name: "搜索学习记忆" }));
    await screen.findByText("RAG 要保留引用。");

    fireEvent.click(screen.getByRole("button", { name: "生成学习报告" }));
    await screen.findByText("本次学习文档：RAG Guide");

    await waitFor(() => {
      expect(
        (api.getStats as MockedFunction<AssistantApi["getStats"]>).mock.calls.length,
      ).toBeGreaterThanOrEqual(4);
    });
  });
});
