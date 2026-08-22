/**
 * 浏览器和 Fastify 后端之间的 HTTP 数据契约。
 *
 * 这里描述的是 JSON 或 multipart 在网络上的形状，不能从后端源码导入类型。
 * 这样前端可以独立安装、构建和部署。
 */

export const assistantApiPaths = {
  health: "/api/health",
  uploadPdf: "/api/documents/pdf",
  askQuestion: "/api/questions",
  chat: "/api/chat",
  addNote: "/api/notes",
  searchMemories: "/api/memories/search",
  stats: "/api/stats",
  reports: "/api/reports",
} as const;

export type AssistantApiPath =
  (typeof assistantApiPaths)[keyof typeof assistantApiPaths];

export interface ApiSuccessResponse<TData> {
  success: true;
  data: TData;
}

export interface ApiErrorDetail {
  code: string;
  message: string;
  requestId: string;
}

export interface ApiErrorResponse {
  success: false;
  error: ApiErrorDetail;
}

export type ApiResponse<TData> =
  | ApiSuccessResponse<TData>
  | ApiErrorResponse;

export interface HealthResponse {
  status: "ok";
  service: "document-qa-assistant";
}

export type MemoryType =
  | "working"
  | "episodic"
  | "semantic"
  | "perceptual";

export interface CurrentDocument {
  documentId: string;
  title: string;
  source: string;
  pageCount: number;
  chunkCount: number;
  loadedAt: string;
}

export interface RagIngestionResult {
  documentId: string;
  chunkCount: number;
  replaced: boolean;
}

export interface LoadPdfResult {
  document: CurrentDocument;
  ingestion: RagIngestionResult;
  durationMs: number;
  warnings: string[];
}

/**
 * HTTP 传输时会被转换为 FormData，并使用字段名 file。
 */
export interface UploadPdfRequest {
  file: File;
}

export interface AskDocumentRequest {
  question: string;
  scope?: "current_document" | "knowledge_base";
  useAdvancedSearch?: boolean;
  enableMqe?: boolean;
  enableHyde?: boolean;
  limit?: number;
  minScore?: number;
  maxContextCharacters?: number;
}

export interface RagCitation {
  index: number;
  documentId: string;
  source: string;
  headingPath?: string;
  startOffset: number;
  endOffset: number;
  score: number;
}

export interface AskDocumentResult {
  question: string;
  answer: string;
  citations: RagCitation[];
  documentId?: string;
  warnings: string[];
}

export interface ChatRequest {
  message: string;
}

export interface AgentResult {
  answer: string;
  steps: number;
}

export interface AddNoteRequest {
  content: string;
  concept?: string;
}

export interface AddNoteResult {
  memoryId: string;
}

export interface SearchMemoriesRequest {
  query: string;
  memoryTypes?: MemoryType[];
  limit?: number;
  minImportance?: number;
}

export interface MemoryItem {
  id: string;
  content: string;
  memoryType: MemoryType;
  userId: string;
  timestamp: string;
  importance: number;
  metadata: Record<string, unknown>;
}

export interface MemoryScoreSignals {
  relevance: number;
  importance: number;
  lexical?: number;
  vector?: number;
  graph?: number;
  recency?: number;
}

export interface MemorySearchResult {
  item: MemoryItem;
  score: number;
  signals: MemoryScoreSignals;
}

export interface SearchMemoriesResult {
  count: number;
  results: MemorySearchResult[];
}

export interface RagStats {
  documents: number;
  chunks: number;
}

export interface MemoryStats {
  type: MemoryType;
  count: number;
  averageImportance: number;
}

export interface MemoryManagerStats {
  userId: string;
  totalMemories: number;
  memoriesByType: Partial<Record<MemoryType, MemoryStats>>;
}

export interface AssistantMetrics {
  documentsLoaded: number;
  questionsAsked: number;
  notesAdded: number;
  agentInteractions: number;
}

export interface AssistantStats {
  sessionId: string;
  userId: string;
  namespace: string;
  sessionStartedAt: string;
  durationSeconds: number;

  /**
   * 后端值为 undefined 时 JSON 会省略这个属性。
   */
  currentDocument?: CurrentDocument;

  metrics: AssistantMetrics;
  rag: RagStats;
  memory: MemoryManagerStats;
}

export interface GenerateReportRequest {
  saveToFile?: boolean;
  memorySummaryLimit?: number;
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
  currentDocument?: CurrentDocument;
  rag: RagStats;
  memory: MemoryManagerStats;
  memorySummary: MemoryItem[];
}

export interface GenerateReportResult {
  report: LearningReport;
  reportFile?: string;
}

/**
 * 所有已开放端点的请求和成功响应映射。
 * 后续 API Client 将以该映射作为静态类型来源。
 */
export interface AssistantApiContract {
  "GET /api/health": {
    request: undefined;
    response: HealthResponse;
  };

  "POST /api/documents/pdf": {
    request: UploadPdfRequest;
    response: ApiSuccessResponse<LoadPdfResult>;
  };

  "POST /api/questions": {
    request: AskDocumentRequest;
    response: ApiSuccessResponse<AskDocumentResult>;
  };

  "POST /api/chat": {
    request: ChatRequest;
    response: ApiSuccessResponse<AgentResult>;
  };

  "POST /api/notes": {
    request: AddNoteRequest;
    response: ApiSuccessResponse<AddNoteResult>;
  };

  "POST /api/memories/search": {
    request: SearchMemoriesRequest;
    response: ApiSuccessResponse<SearchMemoriesResult>;
  };

  "GET /api/stats": {
    request: undefined;
    response: ApiSuccessResponse<AssistantStats>;
  };

  "POST /api/reports": {
    request: GenerateReportRequest;
    response: ApiSuccessResponse<GenerateReportResult>;
  };
}

export type AssistantApiOperation = keyof AssistantApiContract;
