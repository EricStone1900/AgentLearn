import {
  ApiClientError,
  isApiClientError,
} from "./api-error.js";
import type {
  ApiErrorResponse,
  ApiSuccessResponse,
} from "./contracts.js";

export interface ApiClientOptions {
  /**
   * 允许使用相对路径 /api（开发代理）或完整后端 origin（生产环境）。
   */
  baseUrl: string;
  fetchImplementation?: typeof fetch;
  defaultTimeoutMs?: number;
}

export interface ApiRequestOptions {
  method: "GET" | "POST";
  path: string;
  body?: BodyInit;
  headers?: HeadersInit;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface ApiClient {
  requestJson<TResponse>(
    options: ApiRequestOptions,
  ): Promise<TResponse>;

  requestSuccess<TData>(
    options: ApiRequestOptions,
  ): Promise<TData>;
}

interface AbortState {
  signal: AbortSignal;
  clear(): void;
  getReason(): "timeout" | "aborted" | undefined;
}

function normalizeBaseUrl(value: string): string {
  const normalized = value.trim();

  if (!normalized || normalized === "/") {
    return "";
  }

  return normalized.endsWith("/")
    ? normalized.slice(0, -1)
    : normalized;
}

function buildUrl(baseUrl: string, path: string): string {
  const normalizedPath = path.trim();

  if (!normalizedPath.startsWith("/")) {
    throw new Error("API path 必须以 / 开头");
  }

  if (!baseUrl || normalizedPath === baseUrl || normalizedPath.startsWith(`${baseUrl}/`)) {
    return normalizedPath;
  }

  return `${baseUrl}${normalizedPath}`;
}

function createAbortState(
  externalSignal: AbortSignal | undefined,
  timeoutMs: number,
): AbortState {
  const controller = new AbortController();
  let reason: "timeout" | "aborted" | undefined;

  const abortFromCaller = (): void => {
    reason = "aborted";
    controller.abort();
  };

  if (externalSignal?.aborted) {
    abortFromCaller();
  } else {
    externalSignal?.addEventListener(
      "abort",
      abortFromCaller,
      {
        once: true,
      },
    );
  }

  const timer = setTimeout(() => {
    reason = "timeout";
    controller.abort();
  }, timeoutMs);

  return {
    signal: controller.signal,

    clear(): void {
      clearTimeout(timer);
      externalSignal?.removeEventListener(
        "abort",
        abortFromCaller,
      );
    },

    getReason(): "timeout" | "aborted" | undefined {
      return reason;
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isApiErrorResponse(value: unknown): value is ApiErrorResponse {
  if (!isRecord(value) || value.success !== false || !isRecord(value.error)) {
    return false;
  }

  return (
    typeof value.error.code === "string" &&
    typeof value.error.message === "string" &&
    typeof value.error.requestId === "string"
  );
}

function isApiSuccessResponse<TData>(
  value: unknown,
): value is ApiSuccessResponse<TData> {
  return isRecord(value) && value.success === true && "data" in value;
}

async function parseJsonResponse(response: Response): Promise<unknown> {
  const responseText = await response.text();

  if (!responseText.trim()) {
    throw new ApiClientError(
      "后端返回了空响应，无法解析 JSON",
      {
        kind: "invalid_response",
        status: response.status,
      },
    );
  }

  try {
    return JSON.parse(responseText) as unknown;
  } catch (error: unknown) {
    throw new ApiClientError(
      "后端返回的内容不是合法 JSON",
      {
        kind: "invalid_response",
        status: response.status,
        cause: error,
      },
    );
  }
}

function toApiError(
  payload: ApiErrorResponse,
  status: number,
): ApiClientError {
  return new ApiClientError(payload.error.message, {
    kind: "api",
    status,
    code: payload.error.code,
    requestId: payload.error.requestId,
  });
}

function toUnexpectedStatusError(
  response: Response,
): ApiClientError {
  return new ApiClientError(
    `请求失败，HTTP 状态码：${response.status}`,
    {
      kind: "api",
      status: response.status,
      code: "HTTP_ERROR",
    },
  );
}

export function createApiClient(
  options: ApiClientOptions,
): ApiClient {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const fetchImplementation =
    options.fetchImplementation ?? globalThis.fetch;

  if (!fetchImplementation) {
    throw new Error("当前环境不支持 fetch");
  }

  const defaultTimeoutMs = options.defaultTimeoutMs ?? 30_000;

  if (!Number.isInteger(defaultTimeoutMs) || defaultTimeoutMs < 1) {
    throw new Error("defaultTimeoutMs 必须是正整数");
  }

  async function requestJson<TResponse>(
    requestOptions: ApiRequestOptions,
  ): Promise<TResponse> {
    const timeoutMs =
      requestOptions.timeoutMs ?? defaultTimeoutMs;

    if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
      throw new Error("timeoutMs 必须是正整数");
    }

    const abortState = createAbortState(
      requestOptions.signal,
      timeoutMs,
    );

    let response: Response;

    try {
      response = await fetchImplementation(
        buildUrl(baseUrl, requestOptions.path),
        {
          method: requestOptions.method,
          ...(requestOptions.headers
            ? {
                headers: requestOptions.headers,
              }
            : {}),
          ...(requestOptions.body === undefined
            ? {}
            : {
                body: requestOptions.body,
              }),
          signal: abortState.signal,
        },
      );
    } catch (error: unknown) {
      const abortReason = abortState.getReason();

      if (abortReason === "timeout") {
        throw new ApiClientError("请求超时，请稍后重试", {
          kind: "timeout",
          cause: error,
        });
      }

      if (abortReason === "aborted") {
        throw new ApiClientError("请求已取消", {
          kind: "aborted",
          cause: error,
        });
      }

      if (isApiClientError(error)) {
        throw error;
      }

      throw new ApiClientError("无法连接后端服务", {
        kind: "network",
        cause: error,
      });
    } finally {
      abortState.clear();
    }

    const payload = await parseJsonResponse(response);

    if (isApiErrorResponse(payload)) {
      throw toApiError(payload, response.status);
    }

    if (!response.ok) {
      throw toUnexpectedStatusError(response);
    }

    return payload as TResponse;
  }

  async function requestSuccess<TData>(
    requestOptions: ApiRequestOptions,
  ): Promise<TData> {
    const payload = await requestJson<unknown>(requestOptions);

    if (!isApiSuccessResponse<TData>(payload)) {
      throw new ApiClientError(
        "后端成功响应不符合预期格式",
        {
          kind: "invalid_response",
        },
      );
    }

    return payload.data;
  }

  return {
    requestJson,
    requestSuccess,
  };
}
