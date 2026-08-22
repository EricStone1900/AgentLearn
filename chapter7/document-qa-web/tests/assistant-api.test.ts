import {
  describe,
  expect,
  it,
  vi,
  type MockedFunction,
} from "vitest";
import {
  createAssistantApi,
} from "../src/api/assistant-api.js";
import type {
  ApiClient,
  ApiRequestOptions,
} from "../src/api/api-client.js";

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: {
      "content-type": "application/json",
    },
  });
}

describe("AssistantApi", () => {
  it("健康检查使用未包装的后端响应", async () => {
    const fetchMock: MockedFunction<typeof fetch> = vi.fn<typeof fetch>();

    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        status: "ok",
        service: "document-qa-assistant",
      }),
    );

    const api = createAssistantApi({
      clientOptions: {
        baseUrl: "/api",
        fetchImplementation: fetchMock,
      },
    });

    await expect(api.health()).resolves.toEqual({
      status: "ok",
      service: "document-qa-assistant",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/health",
      expect.objectContaining({
        method: "GET",
      }),
    );
  });

  it("上传 PDF 使用 FormData 且不手动设置 Content-Type", async () => {
    const fetchMock: MockedFunction<typeof fetch> = vi.fn<typeof fetch>();

    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        success: true,
        data: {
          document: {
            documentId: "doc-1",
            title: "RAG Guide",
            source: "guide.pdf",
            pageCount: 1,
            chunkCount: 2,
            loadedAt: "2026-08-22T00:00:00.000Z",
          },
          ingestion: {
            documentId: "doc-1",
            chunkCount: 2,
            replaced: false,
          },
          durationMs: 10,
          warnings: [],
        },
      }),
    );

    const api = createAssistantApi({
      clientOptions: {
        baseUrl: "/api",
        fetchImplementation: fetchMock,
      },
    });

    const file = new File(
      ["%PDF-1.4"],
      "guide.pdf",
      {
        type: "application/pdf",
      },
    );

    await expect(
      api.uploadPdf({
        file,
      }),
    ).resolves.toMatchObject({
      document: {
        documentId: "doc-1",
      },
    });

    const requestInit = fetchMock.mock.calls[0]?.[1];

    expect(requestInit?.body).toBeInstanceOf(FormData);
    expect(requestInit?.headers).toBeUndefined();

    const formData = requestInit?.body as FormData;

    expect(formData.get("file")).toBeInstanceOf(File);
  });

  it("上传 PDF 使用独立的较长超时", async () => {
    const recordedRequests: ApiRequestOptions[] = [];
    const uploadResult = {
      document: {
        documentId: "doc-1",
        title: "RAG Guide",
        source: "guide.pdf",
        pageCount: 1,
        chunkCount: 2,
        loadedAt: "2026-08-22T00:00:00.000Z",
      },
      ingestion: {
        documentId: "doc-1",
        chunkCount: 2,
        replaced: false,
      },
      durationMs: 10,
      warnings: [],
    };

    const client: ApiClient = {
      requestJson<TResponse>(): Promise<TResponse> {
        return Promise.reject(new Error("本测试不调用 requestJson"));
      },

      requestSuccess<TData>(
        request: ApiRequestOptions,
      ): Promise<TData> {
        recordedRequests.push(request);
        return Promise.resolve(uploadResult as TData);
      },
    };

    const api = createAssistantApi({
      client,
      uploadTimeoutMs: 180_000,
    });

    await api.uploadPdf({
      file: new File(["%PDF-1.4"], "guide.pdf", {
        type: "application/pdf",
      }),
    });

    expect(recordedRequests).toHaveLength(1);
    expect(recordedRequests[0]).toEqual(
      expect.objectContaining({ timeoutMs: 180_000 }),
    );
  });

  it("文档问答以 JSON 调用对应端点并解包 data", async () => {
    const fetchMock: MockedFunction<typeof fetch> = vi.fn<typeof fetch>();

    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        success: true,
        data: {
          question: "什么是 RAG？",
          answer: "RAG 会先检索资料。",
          citations: [],
          warnings: [],
        },
      }),
    );

    const api = createAssistantApi({
      clientOptions: {
        baseUrl: "/api",
        fetchImplementation: fetchMock,
      },
    });

    const result = await api.askDocument({
      question: "什么是 RAG？",
      enableMqe: true,
    });

    expect(result.answer).toBe("RAG 会先检索资料。");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/questions",
      expect.objectContaining({
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          question: "什么是 RAG？",
          enableMqe: true,
        }),
      }),
    );
  });
});
