import {
  createApiClient,
} from "./api-client.js";
import {
  assistantApiPaths,
} from "./contracts.js";
import type {
  ApiClient,
  ApiClientOptions,
  ApiRequestOptions,
} from "./api-client.js";
import type {
  AddNoteRequest,
  AddNoteResult,
  AgentResult,
  AskDocumentRequest,
  AskDocumentResult,
  AssistantStats,
  ChatRequest,
  GenerateReportRequest,
  GenerateReportResult,
  HealthResponse,
  LoadPdfResult,
  SearchMemoriesRequest,
  SearchMemoriesResult,
  UploadPdfRequest,
} from "./contracts.js";

export interface CreateAssistantApiOptions {
  client?: ApiClient;
  clientOptions?: ApiClientOptions;
  /** PDF 首次入库包含解析、切分和向量化，通常比普通 API 请求更慢。 */
  uploadTimeoutMs?: number;
}

export interface AssistantApi {
  health(signal?: AbortSignal): Promise<HealthResponse>;
  uploadPdf(
    input: UploadPdfRequest,
    signal?: AbortSignal,
  ): Promise<LoadPdfResult>;
  askDocument(
    input: AskDocumentRequest,
    signal?: AbortSignal,
  ): Promise<AskDocumentResult>;
  chat(
    input: ChatRequest,
    signal?: AbortSignal,
  ): Promise<AgentResult>;
  addNote(
    input: AddNoteRequest,
    signal?: AbortSignal,
  ): Promise<AddNoteResult>;
  searchMemories(
    input: SearchMemoriesRequest,
    signal?: AbortSignal,
  ): Promise<SearchMemoriesResult>;
  getStats(signal?: AbortSignal): Promise<AssistantStats>;
  generateReport(
    input: GenerateReportRequest,
    signal?: AbortSignal,
  ): Promise<GenerateReportResult>;
}

function toJsonBody(value: unknown): string {
  return JSON.stringify(value);
}

function jsonHeaders(): HeadersInit {
  return {
    "content-type": "application/json",
  };
}

function withOptionalSignal(
  signal: AbortSignal | undefined,
): Pick<ApiRequestOptions, "signal"> | Record<never, never> {
  return signal
    ? {
        signal,
      }
    : {};
}

export function createAssistantApi(
  options: CreateAssistantApiOptions,
): AssistantApi {
  const client =
    options.client ??
    (options.clientOptions
      ? createApiClient(options.clientOptions)
      : undefined);

  if (!client) {
    throw new Error(
      "createAssistantApi 需要 client 或 clientOptions",
    );
  }

  if (
    options.uploadTimeoutMs !== undefined &&
    (!Number.isInteger(options.uploadTimeoutMs) || options.uploadTimeoutMs < 1)
  ) {
    throw new Error("uploadTimeoutMs 必须是正整数");
  }

  return {
    health(signal?: AbortSignal): Promise<HealthResponse> {
      return client.requestJson<HealthResponse>({
        method: "GET",
        path: assistantApiPaths.health,
        ...withOptionalSignal(signal),
      });
    },

    uploadPdf(
      input: UploadPdfRequest,
      signal?: AbortSignal,
    ): Promise<LoadPdfResult> {
      const formData = new FormData();

      formData.append(
        "file",
        input.file,
        input.file.name,
      );

      /*
       * 不设置 Content-Type。
       * 浏览器会自动生成 multipart boundary；手动设置会导致后端无法解析。
       */
      return client.requestSuccess<LoadPdfResult>({
        method: "POST",
        path: assistantApiPaths.uploadPdf,
        body: formData,
        ...(options.uploadTimeoutMs === undefined
          ? {}
          : {
              timeoutMs: options.uploadTimeoutMs,
            }),
        ...withOptionalSignal(signal),
      });
    },

    askDocument(
      input: AskDocumentRequest,
      signal?: AbortSignal,
    ): Promise<AskDocumentResult> {
      return client.requestSuccess<AskDocumentResult>({
        method: "POST",
        path: assistantApiPaths.askQuestion,
        headers: jsonHeaders(),
        body: toJsonBody(input),
        ...withOptionalSignal(signal),
      });
    },

    chat(
      input: ChatRequest,
      signal?: AbortSignal,
    ): Promise<AgentResult> {
      return client.requestSuccess<AgentResult>({
        method: "POST",
        path: assistantApiPaths.chat,
        headers: jsonHeaders(),
        body: toJsonBody(input),
        ...withOptionalSignal(signal),
      });
    },

    addNote(
      input: AddNoteRequest,
      signal?: AbortSignal,
    ): Promise<AddNoteResult> {
      return client.requestSuccess<AddNoteResult>({
        method: "POST",
        path: assistantApiPaths.addNote,
        headers: jsonHeaders(),
        body: toJsonBody(input),
        ...withOptionalSignal(signal),
      });
    },

    searchMemories(
      input: SearchMemoriesRequest,
      signal?: AbortSignal,
    ): Promise<SearchMemoriesResult> {
      return client.requestSuccess<SearchMemoriesResult>({
        method: "POST",
        path: assistantApiPaths.searchMemories,
        headers: jsonHeaders(),
        body: toJsonBody(input),
        ...withOptionalSignal(signal),
      });
    },

    getStats(signal?: AbortSignal): Promise<AssistantStats> {
      return client.requestSuccess<AssistantStats>({
        method: "GET",
        path: assistantApiPaths.stats,
        ...withOptionalSignal(signal),
      });
    },

    generateReport(
      input: GenerateReportRequest,
      signal?: AbortSignal,
    ): Promise<GenerateReportResult> {
      return client.requestSuccess<GenerateReportResult>({
        method: "POST",
        path: assistantApiPaths.reports,
        headers: jsonHeaders(),
        body: toJsonBody(input),
        ...withOptionalSignal(signal),
      });
    },
  };
}
