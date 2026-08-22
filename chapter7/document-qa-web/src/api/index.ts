export {
  assistantApiPaths,
} from "./contracts.js";

export {
  createApiClient,
} from "./api-client.js";

export {
  ApiClientError,
  isApiClientError,
} from "./api-error.js";

export {
  createAssistantApi,
} from "./assistant-api.js";

export type {
  AddNoteRequest,
  AddNoteResult,
  AgentResult,
  ApiErrorDetail,
  ApiErrorResponse,
  ApiResponse,
  ApiSuccessResponse,
  AskDocumentRequest,
  AskDocumentResult,
  AssistantApiContract,
  AssistantApiOperation,
  AssistantApiPath,
  AssistantMetrics,
  AssistantStats,
  ChatRequest,
  CurrentDocument,
  GenerateReportRequest,
  GenerateReportResult,
  HealthResponse,
  LearningReport,
  LoadPdfResult,
  MemoryItem,
  MemoryManagerStats,
  MemoryScoreSignals,
  MemorySearchResult,
  MemoryStats,
  MemoryType,
  RagCitation,
  RagIngestionResult,
  RagStats,
  SearchMemoriesRequest,
  SearchMemoriesResult,
  UploadPdfRequest,
} from "./contracts.js";

export type {
  ApiClient,
  ApiClientOptions,
  ApiRequestOptions,
} from "./api-client.js";

export type {
  ApiClientErrorKind,
  ApiClientErrorOptions,
} from "./api-error.js";

export type {
  AssistantApi,
  CreateAssistantApiOptions,
} from "./assistant-api.js";
