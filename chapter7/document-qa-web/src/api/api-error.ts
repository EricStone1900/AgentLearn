export type ApiClientErrorKind =
  | "api"
  | "network"
  | "timeout"
  | "aborted"
  | "invalid_response";

export interface ApiClientErrorOptions {
  kind: ApiClientErrorKind;
  status?: number;
  code?: string;
  requestId?: string;
  cause?: unknown;
}

/**
 * 前端对所有 API 失败使用的统一错误类型。
 *
 * 业务组件只需要根据 kind、code 和 requestId 决定展示方式，
 * 不必自行区分 fetch、超时和 Fastify 错误响应。
 */
export class ApiClientError extends Error {
  public readonly kind: ApiClientErrorKind;
  public readonly status: number | undefined;
  public readonly code: string | undefined;
  public readonly requestId: string | undefined;

  public constructor(
    message: string,
    options: ApiClientErrorOptions,
  ) {
    super(message, {
      cause: options.cause,
    });

    this.name = "ApiClientError";
    this.kind = options.kind;
    this.status = options.status;
    this.code = options.code;
    this.requestId = options.requestId;
  }
}

export function isApiClientError(
  error: unknown,
): error is ApiClientError {
  return error instanceof ApiClientError;
}
