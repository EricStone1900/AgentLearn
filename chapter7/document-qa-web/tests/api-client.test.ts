import {
  afterEach,
  describe,
  expect,
  it,
  vi,
  type MockedFunction,
} from "vitest";
import {
  createApiClient,
} from "../src/api/api-client.js";
import {
  ApiClientError,
} from "../src/api/api-error.js";

function jsonResponse(
  value: unknown,
  status = 200,
): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json",
    },
  });
}

describe("ApiClient", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("保留 /api 前缀并解析 JSON 成功响应", async () => {
    const fetchMock: MockedFunction<typeof fetch> = vi.fn<typeof fetch>();

    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        status: "ok",
      }),
    );

    const client = createApiClient({
      baseUrl: "/api",
      fetchImplementation: fetchMock,
    });

    const result = await client.requestJson<{
      status: string;
    }>({
      method: "GET",
      path: "/api/health",
    });

    expect(result).toEqual({
      status: "ok",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/health",
      expect.objectContaining({
        method: "GET",
      }),
    );
  });

  it("将后端标准错误响应转换为 ApiClientError", async () => {
    const fetchMock: MockedFunction<typeof fetch> = vi.fn<typeof fetch>();

    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          success: false,
          error: {
            code: "NO_DOCUMENT_LOADED",
            message: "请先上传并加载 PDF 文档",
            requestId: "request-1",
          },
        },
        409,
      ),
    );

    const client = createApiClient({
      baseUrl: "/api",
      fetchImplementation: fetchMock,
    });

    const request = client.requestSuccess<never>({
      method: "POST",
      path: "/api/questions",
    });

    await expect(request).rejects.toMatchObject({
      name: "ApiClientError",
      kind: "api",
      status: 409,
      code: "NO_DOCUMENT_LOADED",
      requestId: "request-1",
    } satisfies Partial<ApiClientError>);
  });

  it("将非 JSON 响应标记为 invalid_response", async () => {
    const fetchMock: MockedFunction<typeof fetch> = vi.fn<typeof fetch>();

    fetchMock.mockResolvedValueOnce(
      new Response("upstream unavailable", {
        status: 502,
      }),
    );

    const client = createApiClient({
      baseUrl: "/api",
      fetchImplementation: fetchMock,
    });

    await expect(
      client.requestJson({
        method: "GET",
        path: "/api/health",
      }),
    ).rejects.toMatchObject({
      kind: "invalid_response",
      status: 502,
    } satisfies Partial<ApiClientError>);
  });

  it("超时后中止 fetch 并返回 timeout 错误", async () => {
    vi.useFakeTimers();

    const fetchMock: MockedFunction<typeof fetch> = vi.fn<typeof fetch>();

    fetchMock.mockImplementation(
      async (_input, init): Promise<Response> => {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => {
              reject(new DOMException("aborted", "AbortError"));
            },
            {
              once: true,
            },
          );
        });
      },
    );

    const client = createApiClient({
      baseUrl: "/api",
      fetchImplementation: fetchMock,
      defaultTimeoutMs: 20,
    });

    const request = client.requestJson({
      method: "GET",
      path: "/api/health",
    });

    const expectation = expect(request).rejects.toMatchObject({
      kind: "timeout",
    } satisfies Partial<ApiClientError>);

    await vi.advanceTimersByTimeAsync(20);

    await expectation;
  });

  it("调用方取消请求时返回 aborted 错误", async () => {
    const fetchMock: MockedFunction<typeof fetch> = vi.fn<typeof fetch>();

    fetchMock.mockImplementation(
      async (_input, init): Promise<Response> => {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => {
              reject(new DOMException("aborted", "AbortError"));
            },
            {
              once: true,
            },
          );
        });
      },
    );

    const client = createApiClient({
      baseUrl: "/api",
      fetchImplementation: fetchMock,
    });

    const controller = new AbortController();

    const request = client.requestJson({
      method: "GET",
      path: "/api/health",
      signal: controller.signal,
    });

    controller.abort();

    await expect(request).rejects.toMatchObject({
      kind: "aborted",
    } satisfies Partial<ApiClientError>);
  });
});
