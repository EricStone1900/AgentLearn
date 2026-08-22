import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerAssistantApi } from "../src/app/register-assistant-api.js";
import { createApp } from "../src/app/create-app.js";
import type { AssistantHttpApi } from "../src/routes/assistant.js";

function createMultipartPayload(
  boundary: string,
  fileName: string,
  content: Buffer,
): Buffer {
  const header = Buffer.from(
    [
      `--${boundary}`,
      `Content-Disposition: form-data; name="file"; filename="${fileName}"`,
      "Content-Type: application/pdf",
      "",
      "",
    ].join("\r\n"),
    "utf8",
  );

  const footer = Buffer.from(`\r\n--${boundary}--\r\n`, "utf8");

  return Buffer.concat([header, content, footer]);
}

describe("Assistant HTTP API", () => {
  let app: FastifyInstance;

  let uploadRoot: string;

  let currentDocument:
    | ReturnType<AssistantHttpApi["getCurrentDocument"]>
    | undefined;

  let receivedUploadPath: string | undefined;

  beforeEach(async () => {
    uploadRoot = await mkdtemp(join(tmpdir(), "document-qa-api-"));

    currentDocument = {
      documentId: "doc-1",

      title: "RAG Guide",

      source: "rag-guide.pdf",

      pageCount: 1,

      chunkCount: 2,

      loadedAt: "2026-08-22T00:00:00.000Z",
    };

    const assistant: AssistantHttpApi = {
      getCurrentDocument() {
        return currentDocument;
      },

      loadPdf: vi.fn(async (filePath) => {
        receivedUploadPath = filePath;

        const content = await readFile(filePath);

        expect(content.subarray(0, 5).toString("ascii")).toBe("%PDF-");

        return {
          document: {
            documentId: "doc-1",

            title: "RAG Guide",

            source: "rag-guide.pdf",

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
      }),

      ask: vi.fn(async (question) => {
        return {
          question,

          documentId: "doc-1",

          answer: "RAG 会先检索相关资料。[S1]",

          citations: [],

          warnings: [],
        };
      }),

      chat: vi.fn(async () => {
        return {
          answer: "Agent answer",

          steps: 2,
        };
      }),

      addNote: vi.fn(async () => "memory-1"),

      recall: vi.fn(async () => []),

      getStats: vi.fn(async () => {
        throw new Error("本测试未实现 getStats");
      }),

      generateReport: vi.fn(async () => {
        throw new Error("本测试未实现 generateReport");
      }),
    };

    app = createApp();

    registerAssistantApi(app, {
      assistant,

      uploadRoot,

      maxUploadBytes: 1024 * 1024,
    });
  });

  afterEach(async () => {
    await app.close();

    await rm(uploadRoot, {
      recursive: true,

      force: true,
    });
  });

  it("上传 PDF 并在处理完成后删除临时文件", async () => {
    const boundary = "test-boundary-123";

    const pdfContent = Buffer.from("%PDF-1.4\nTest PDF content", "ascii");

    const response = await app.inject({
      method: "POST",

      url: "/api/documents/pdf",

      headers: {
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },

      payload: createMultipartPayload(boundary, "rag-guide.pdf", pdfContent),
    });

    expect(response.statusCode).toBe(201);

    expect(response.json()).toMatchObject({
      success: true,

      data: {
        document: {
          documentId: "doc-1",
        },
      },
    });

    expect(receivedUploadPath).toBeDefined();

    await expect(stat(receivedUploadPath ?? "")).rejects.toThrow();
  });

  it("向当前文档提问", async () => {
    const response = await app.inject({
      method: "POST",

      url: "/api/questions",

      payload: {
        question: "什么是 RAG？",

        enableMqe: true,

        enableHyde: true,
      },
    });

    expect(response.statusCode).toBe(200);

    expect(response.json()).toMatchObject({
      success: true,

      data: {
        question: "什么是 RAG？",

        documentId: "doc-1",
      },
    });
  });

  it("未加载文档时返回 409", async () => {
    currentDocument = undefined;

    const response = await app.inject({
      method: "POST",

      url: "/api/questions",

      payload: {
        question: "什么是 RAG？",
      },
    });

    expect(response.statusCode).toBe(409);

    expect(response.json()).toMatchObject({
      success: false,

      error: {
        code: "NO_DOCUMENT_LOADED",
      },
    });
  });

  it("请求参数错误时返回 400", async () => {
    const response = await app.inject({
      method: "POST",

      url: "/api/questions",

      payload: {
        question: "",
        limit: 100,
      },
    });

    expect(response.statusCode).toBe(400);

    expect(response.json()).toMatchObject({
      success: false,

      error: {
        code: "VALIDATION_ERROR",
      },
    });
  });

  it("支持 Agent 开放式对话", async () => {
    const response = await app.inject({
      method: "POST",

      url: "/api/chat",

      payload: {
        message: "总结我的 RAG 学习内容",
      },
    });

    expect(response.statusCode).toBe(200);

    expect(response.json()).toEqual({
      success: true,

      data: {
        answer: "Agent answer",

        steps: 2,
      },
    });
  });

  it("支持添加学习笔记", async () => {
    const response = await app.inject({
      method: "POST",

      url: "/api/notes",

      payload: {
        content: "RAG 的核心是先检索后生成",

        concept: "RAG",
      },
    });

    expect(response.statusCode).toBe(201);

    expect(response.json()).toEqual({
      success: true,

      data: {
        memoryId: "memory-1",
      },
    });
  });
});
