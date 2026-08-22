import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockedFunction,
} from "vitest";
import type { DocumentConverter } from "../src/documents/index.js";
import {
  DocumentQaAssistant,
  type AssistantAgent,
  type AssistantMemoryService,
  type AssistantRagService,
} from "../src/app/document-qa-assistant.js";
import type { LearningReportWriter } from "../src/app/learning-report-writer.js";

describe("DocumentQaAssistant", () => {
  const convertedDocument = {
    title: "RAG Guide",
    source: "rag-guide.pdf",
    markdown: "# RAG Guide\n\n## 第 1 页\n\nRAG 使用向量检索。",
    pageCount: 1,
    metadata: {
      inputType: "pdf",
    },
  };

  let convert: MockedFunction<DocumentConverter["convert"]>;

  let ingestText: MockedFunction<AssistantRagService["ingestText"]>;

  let ragAsk: MockedFunction<AssistantRagService["ask"]>;

  let addMemory: MockedFunction<AssistantMemoryService["addMemory"]>;

  let retrieveMemories: MockedFunction<
    AssistantMemoryService["retrieveMemories"]
  >;

  let agentRun: MockedFunction<AssistantAgent["run"]>;

  let reportWrite: MockedFunction<LearningReportWriter["write"]>;

  let assistant: DocumentQaAssistant;

  beforeEach(() => {
    convert = vi.fn<DocumentConverter["convert"]>(
      async () => convertedDocument,
    );

    ingestText = vi.fn<AssistantRagService["ingestText"]>(async () => ({
      documentId: "doc-1",
      chunkCount: 2,
      replaced: false,
    }));

    ragAsk = vi.fn<AssistantRagService["ask"]>(async () => ({
      answer: "RAG 会先检索相关片段。[S1]",

      citations: [
        {
          index: 1,
          documentId: "doc-1",
          source: "rag-guide.pdf",
          headingPath: "第 1 页",
          startOffset: 0,
          endOffset: 20,
          score: 0.92,
        },
      ],
    }));

    addMemory = vi.fn<AssistantMemoryService["addMemory"]>(
      async () => "memory-1",
    );

    retrieveMemories = vi.fn<AssistantMemoryService["retrieveMemories"]>(
      async () => [],
    );

    agentRun = vi.fn<AssistantAgent["run"]>(async () => ({
      answer: "Agent answer",
      steps: 2,
    }));

    reportWrite = vi.fn<LearningReportWriter["write"]>(
      async () => "learning-report-session-1.json",
    );

    const pdfConverter: DocumentConverter = {
      convert,
    };

    const ragService: AssistantRagService = {
      ingestText,

      ask: ragAsk,

      getStats: vi.fn(async () => ({
        documents: 1,
        chunks: 2,
      })),

      deleteDocument: vi.fn(async () => true),
    };

    const memoryManager: AssistantMemoryService = {
      addMemory,

      retrieveMemories,

      getSummary: vi.fn(async () => []),

      getStats: vi.fn(async () => ({
        userId: "test-user",
        totalMemories: 2,
        memoriesByType: {},
      })),
    };

    const agent: AssistantAgent = {
      run: agentRun,

      clearHistory: vi.fn(),
    };

    const reportWriter: LearningReportWriter = {
      write: reportWrite,
    };

    assistant = new DocumentQaAssistant({
      userId: "test-user",
      namespace: "document-qa:test-user",

      pdfConverter,
      ragService,
      memoryManager,
      agent,
      reportWriter,

      createId: () => "session-1",

      now: () => new Date("2026-08-22T00:00:00.000Z"),
    });
  });

  it("转换 PDF、摄取 RAG 并记录加载事件", async () => {
    const result = await assistant.loadPdf("/uploads/rag-guide.pdf");

    expect(convert).toHaveBeenCalledWith("/uploads/rag-guide.pdf");

    expect(ingestText).toHaveBeenCalledWith(
      convertedDocument.markdown,
      convertedDocument.source,
      expect.objectContaining({
        namespace: "document-qa:test-user",
      }),
    );

    expect(addMemory).toHaveBeenCalledWith(
      expect.objectContaining({
        memoryType: "episodic",
        importance: 0.9,
      }),
    );

    expect(result.document).toMatchObject({
      documentId: "doc-1",
      title: "RAG Guide",
      pageCount: 1,
      chunkCount: 2,
    });

    expect(result.warnings).toEqual([]);
  });

  it("未加载文档时拒绝问答", async () => {
    await expect(assistant.ask("什么是 RAG？")).rejects.toThrow(
      "请先加载 PDF 文档",
    );

    expect(ragAsk).not.toHaveBeenCalled();
  });

  it("默认对当前文档执行 MQE 和 HyDE 问答", async () => {
    await assistant.loadPdf("/uploads/rag-guide.pdf");

    const result = await assistant.ask("什么是 RAG？");

    expect(ragAsk).toHaveBeenCalledWith(
      "什么是 RAG？",
      expect.objectContaining({
        namespace: "document-qa:test-user",

        documentId: "doc-1",

        enableMqe: true,
        enableHyde: true,
        limit: 5,

        maxContextCharacters: 6000,
      }),
    );

    expect(result.answer).toContain("[S1]");

    expect(result.citations).toHaveLength(1);
  });

  it("添加语义笔记并更新统计", async () => {
    const memoryId = await assistant.addNote("RAG 的核心是先检索后生成", "RAG");

    expect(memoryId).toBe("memory-1");

    expect(addMemory).toHaveBeenCalledWith(
      expect.objectContaining({
        memoryType: "semantic",

        importance: 0.8,

        metadata: expect.objectContaining({
          concept: "RAG",
          eventType: "learning_note",
        }),
      }),
    );

    const stats = await assistant.getStats();

    expect(stats.metrics.notesAdded).toBe(1);
  });

  it("支持学习回顾、Agent 对话和报告生成", async () => {
    await assistant.recall("我学过什么？", {
      memoryTypes: ["episodic", "semantic"],

      limit: 3,
    });

    expect(retrieveMemories).toHaveBeenCalledWith({
      query: "我学过什么？",

      limit: 3,

      memoryTypes: ["episodic", "semantic"],
    });

    const chatResult = await assistant.chat("总结我的学习内容");

    expect(chatResult).toEqual({
      answer: "Agent answer",
      steps: 2,
    });

    const reportResult = await assistant.generateReport();

    expect(reportWrite).toHaveBeenCalledWith(
      "session-1",
      expect.objectContaining({
        schemaVersion: 1,
      }),
    );

    expect(reportResult.reportFile).toBe("learning-report-session-1.json");
  });

  it("记忆事件写入失败时保留 RAG 成功结果并返回 warning", async () => {
    addMemory.mockRejectedValueOnce(new Error("memory backend unavailable"));

    const result = await assistant.loadPdf("/uploads/rag-guide.pdf");

    expect(result.document.documentId).toBe("doc-1");

    expect(result.warnings).toEqual([
      "记忆记录失败：memory backend unavailable",
    ]);
  });
});
