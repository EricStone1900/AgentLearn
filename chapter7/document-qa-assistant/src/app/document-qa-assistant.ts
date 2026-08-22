import { randomUUID } from "node:crypto";
import type { AgentResult } from "@ericstone/agent-patterns-ts/core";
import type {
  AddMemoryInput,
  MemoryItem,
  MemoryManager,
  MemoryManagerStats,
  MemorySearchResult,
  MemoryType,
} from "@ericstone/agent-patterns-ts/memory";
import type {
  RagAskResult,
  RagIngestionResult,
  RagService,
  RagStats,
} from "@ericstone/agent-patterns-ts/rag";
import type {
  ConvertedDocument,
  DocumentConverter,
} from "../documents/index.js";
import type { LearningReportWriter } from "./learning-report-writer.js";

export type AssistantRagService = Pick<
  RagService,
  "ingestText" | "ask" | "getStats" | "deleteDocument"
>;

export type AssistantMemoryService = Pick<
  MemoryManager,
  "addMemory" | "retrieveMemories" | "getSummary" | "getStats"
>;

export interface AssistantAgent {
  run(inputText: string): Promise<AgentResult>;

  clearHistory(): void;
}

export interface CurrentDocument {
  documentId: string;
  title: string;
  source: string;
  pageCount: number;
  chunkCount: number;
  loadedAt: string;
}

export interface AssistantMetrics {
  documentsLoaded: number;
  questionsAsked: number;
  notesAdded: number;
  agentInteractions: number;
}

export interface LoadPdfResult {
  document: CurrentDocument;
  ingestion: RagIngestionResult;
  durationMs: number;
  warnings: string[];
}

export interface AskDocumentOptions {
  useAdvancedSearch?: boolean;
  enableMqe?: boolean;
  enableHyde?: boolean;
  limit?: number;
  minScore?: number;
  maxContextCharacters?: number;

  scope?: "current_document" | "knowledge_base";
}

export interface AskDocumentResult extends RagAskResult {
  question: string;
  documentId?: string;
  warnings: string[];
}

export interface RecallOptions {
  limit?: number;
  memoryTypes?: MemoryType[];
  minImportance?: number;
}

export interface AssistantStats {
  sessionId: string;
  userId: string;
  namespace: string;
  sessionStartedAt: string;
  durationSeconds: number;
  currentDocument: CurrentDocument | undefined;
  metrics: AssistantMetrics;
  rag: RagStats;
  memory: MemoryManagerStats;
}

export interface LearningReport {
  schemaVersion: 1;
  generatedAt: string;

  session: {
    sessionId: string;
    userId: string;
    namespace: string;
    startedAt: string;
    durationSeconds: number;
  };

  metrics: AssistantMetrics;

  currentDocument: CurrentDocument | undefined;

  rag: RagStats;
  memory: MemoryManagerStats;
  memorySummary: MemoryItem[];
}

export interface GenerateReportOptions {
  saveToFile?: boolean;
  memorySummaryLimit?: number;
}

export interface GenerateReportResult {
  report: LearningReport;
  reportFile?: string;
}

export interface DocumentQaAssistantOptions {
  userId: string;
  namespace: string;
  pdfConverter: DocumentConverter;
  ragService: AssistantRagService;
  memoryManager: AssistantMemoryService;
  agent: AssistantAgent;
  reportWriter: LearningReportWriter;
  now?: () => Date;
  createId?: () => string;
}

function normalizeRequiredText(value: string, fieldName: string): string {
  const normalized = value.trim();

  if (!normalized) {
    throw new Error(`${fieldName} 不能为空`);
  }

  return normalized;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return value.slice(0, maxLength) + "…";
}

export class DocumentQaAssistant {
  private readonly userId: string;
  private readonly namespace: string;
  private readonly sessionId: string;
  private readonly sessionStartedAt: string;

  private readonly now: () => Date;

  private currentDocument: CurrentDocument | undefined;
  private agentQueue: Promise<void> = Promise.resolve();

  private readonly metrics: AssistantMetrics = {
    documentsLoaded: 0,
    questionsAsked: 0,
    notesAdded: 0,
    agentInteractions: 0,
  };

  private runAgentExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.agentQueue.then(operation, operation);

    this.agentQueue = result.then(
      () => undefined,
      () => undefined,
    );

    return result;
  }

  public constructor(private readonly options: DocumentQaAssistantOptions) {
    this.userId = normalizeRequiredText(options.userId, "userId");

    this.namespace = normalizeRequiredText(options.namespace, "namespace");

    this.now = options.now ?? (() => new Date());

    this.sessionId = (options.createId ?? randomUUID)();

    this.sessionStartedAt = this.now().toISOString();
  }

  public getSessionId(): string {
    return this.sessionId;
  }

  public getNamespace(): string {
    return this.namespace;
  }

  public getCurrentDocument(): CurrentDocument | undefined {
    return this.currentDocument
      ? {
          ...this.currentDocument,
        }
      : undefined;
  }

  private async tryAddMemory(
    input: AddMemoryInput,
    warnings: string[],
  ): Promise<string | undefined> {
    try {
      return await this.options.memoryManager.addMemory(input);
    } catch (error: unknown) {
      warnings.push(`记忆记录失败：${errorMessage(error)}`);

      return undefined;
    }
  }

  public async loadPdf(filePath: string): Promise<LoadPdfResult> {
    const normalizedPath = normalizeRequiredText(filePath, "filePath");

    const startedAt = this.now().getTime();

    const converted = await this.options.pdfConverter.convert(normalizedPath);

    const ingestion = await this.options.ragService.ingestText(
      converted.markdown,
      converted.source,
      {
        namespace: this.namespace,

        metadata: {
          ...converted.metadata,

          title: converted.title,

          sessionId: this.sessionId,

          userId: this.userId,
        },
      },
    );

    const loadedAt = this.now().toISOString();

    const document: CurrentDocument = {
      documentId: ingestion.documentId,

      title: converted.title,

      source: converted.source,

      pageCount: converted.pageCount,

      chunkCount: ingestion.chunkCount,

      loadedAt,
    };

    /*
     * 只有 RAG 摄取成功后才更新当前文档。
     */
    this.currentDocument = document;

    this.metrics.documentsLoaded += 1;

    const warnings: string[] = [];

    /*
     * 记忆属于辅助能力。
     * 如果记忆写入失败，不回滚已经成功建立的 RAG 索引，
     * 但必须通过 warnings 告诉调用方。
     */
    await this.tryAddMemory(
      {
        content: `加载了文档《${converted.title}》`,

        memoryType: "episodic",

        importance: 0.9,

        metadata: {
          eventType: "document_loaded",

          sessionId: this.sessionId,

          documentId: ingestion.documentId,

          source: converted.source,

          pageCount: converted.pageCount,

          chunkCount: ingestion.chunkCount,
        },
      },
      warnings,
    );

    const durationMs = Math.max(0, this.now().getTime() - startedAt);

    return {
      document: {
        ...document,
      },

      ingestion,

      durationMs,

      warnings,
    };
  }

  public async ask(
    question: string,
    options: AskDocumentOptions = {},
  ): Promise<AskDocumentResult> {
    const normalizedQuestion = normalizeRequiredText(question, "question");

    if (!this.currentDocument) {
      throw new Error("请先加载 PDF 文档");
    }

    const warnings: string[] = [];

    await this.tryAddMemory(
      {
        content: `提问：${normalizedQuestion}`,

        memoryType: "working",

        importance: 0.6,

        metadata: {
          eventType: "question_started",

          sessionId: this.sessionId,

          documentId: this.currentDocument.documentId,
        },
      },
      warnings,
    );

    const useAdvancedSearch = options.useAdvancedSearch ?? true;

    const scope = options.scope ?? "current_document";

    const result = await this.options.ragService.ask(normalizedQuestion, {
      namespace: this.namespace,

      limit: options.limit ?? 5,

      enableMqe: options.enableMqe ?? useAdvancedSearch,

      enableHyde: options.enableHyde ?? useAdvancedSearch,

      maxContextCharacters: options.maxContextCharacters ?? 6_000,

      ...(options.minScore === undefined
        ? {}
        : {
            minScore: options.minScore,
          }),

      ...(scope === "current_document"
        ? {
            documentId: this.currentDocument.documentId,
          }
        : {}),
    });

    this.metrics.questionsAsked += 1;

    await this.tryAddMemory(
      {
        content: [
          `问题：${normalizedQuestion}`,
          `回答：${truncate(result.answer, 2_000)}`,
        ].join("\n"),

        memoryType: "episodic",

        importance: 0.7,

        metadata: {
          eventType: "qa_interaction",

          sessionId: this.sessionId,

          documentId: this.currentDocument.documentId,

          citationCount: result.citations.length,
        },
      },
      warnings,
    );

    return {
      question: normalizedQuestion,

      answer: result.answer,

      citations: result.citations,

      ...(scope === "current_document"
        ? {
            documentId: this.currentDocument.documentId,
          }
        : {}),

      warnings,
    };
  }

  public async chat(input: string): Promise<AgentResult> {
    const normalizedInput = normalizeRequiredText(input, "input");

    return this.runAgentExclusive(async () => {
      const result = await this.options.agent.run(normalizedInput);

      this.metrics.agentInteractions += 1;

      return result;
    });
  }

  public async addNote(content: string, concept = "general"): Promise<string> {
    const normalizedContent = normalizeRequiredText(content, "content");

    const normalizedConcept = normalizeRequiredText(concept, "concept");

    const memoryId = await this.options.memoryManager.addMemory({
      content: normalizedContent,

      memoryType: "semantic",

      importance: 0.8,

      metadata: {
        eventType: "learning_note",

        concept: normalizedConcept,

        sessionId: this.sessionId,

        ...(this.currentDocument
          ? {
              documentId: this.currentDocument.documentId,

              source: this.currentDocument.source,
            }
          : {}),
      },
    });

    this.metrics.notesAdded += 1;

    return memoryId;
  }

  public async recall(
    query: string,
    options: RecallOptions = {},
  ): Promise<MemorySearchResult[]> {
    const normalizedQuery = normalizeRequiredText(query, "query");

    return this.options.memoryManager.retrieveMemories({
      query: normalizedQuery,

      limit: options.limit ?? 5,

      ...(options.memoryTypes
        ? {
            memoryTypes: options.memoryTypes,
          }
        : {}),

      ...(options.minImportance === undefined
        ? {}
        : {
            minImportance: options.minImportance,
          }),
    });
  }

  public async getStats(): Promise<AssistantStats> {
    const [rag, memory] = await Promise.all([
      this.options.ragService.getStats(this.namespace),

      this.options.memoryManager.getStats(),
    ]);

    const now = this.now();

    return {
      sessionId: this.sessionId,

      userId: this.userId,

      namespace: this.namespace,

      sessionStartedAt: this.sessionStartedAt,

      durationSeconds: Math.max(
        0,
        Math.floor((now.getTime() - Date.parse(this.sessionStartedAt)) / 1_000),
      ),

      currentDocument: this.getCurrentDocument(),

      metrics: {
        ...this.metrics,
      },

      rag,

      memory,
    };
  }

  public async generateReport(
    options: GenerateReportOptions = {},
  ): Promise<GenerateReportResult> {
    const [stats, memorySummary] = await Promise.all([
      this.getStats(),

      this.options.memoryManager.getSummary(options.memorySummaryLimit ?? 10),
    ]);

    const report: LearningReport = {
      schemaVersion: 1,

      generatedAt: this.now().toISOString(),

      session: {
        sessionId: stats.sessionId,

        userId: stats.userId,

        namespace: stats.namespace,

        startedAt: stats.sessionStartedAt,

        durationSeconds: stats.durationSeconds,
      },

      metrics: {
        ...stats.metrics,
      },

      currentDocument: stats.currentDocument
        ? {
            ...stats.currentDocument,
          }
        : undefined,

      rag: stats.rag,

      memory: stats.memory,

      memorySummary,
    };

    if (options.saveToFile === false) {
      return {
        report,
      };
    }

    const reportFile = await this.options.reportWriter.write(
      this.sessionId,
      report,
    );

    return {
      report,
      reportFile,
    };
  }
}
