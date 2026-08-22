import { createWriteStream } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { basename, extname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import type { MultipartFile } from "@fastify/multipart";
import type { FastifyPluginAsync } from "fastify";
import { memoryTypeSchema } from "@ericstone/agent-patterns-ts/memory";
import { z } from "zod";
import type { DocumentQaAssistant } from "../app/document-qa-assistant.js";
import { DocumentConversionError } from "../documents/index.js";
import { ApiError } from "../http/api-error.js";

export type AssistantHttpApi = Pick<
  DocumentQaAssistant,
  | "getCurrentDocument"
  | "loadPdf"
  | "ask"
  | "chat"
  | "addNote"
  | "recall"
  | "getStats"
  | "generateReport"
>;

export interface AssistantRoutesOptions {
  assistant: AssistantHttpApi;
  uploadRoot: string;
  maxUploadBytes: number;
}

const questionBodySchema = z
  .object({
    question: z.string().trim().min(1).max(4_000),

    scope: z
      .enum(["current_document", "knowledge_base"])
      .default("current_document"),

    useAdvancedSearch: z.boolean().default(true),

    enableMqe: z.boolean().optional(),

    enableHyde: z.boolean().optional(),

    limit: z.number().int().min(1).max(20).default(5),

    minScore: z.number().min(-1).max(1).optional(),

    maxContextCharacters: z.number().int().min(500).max(30_000).default(6_000),
  })
  .strict();

const chatBodySchema = z
  .object({
    message: z.string().trim().min(1).max(8_000),
  })
  .strict();

const noteBodySchema = z
  .object({
    content: z.string().trim().min(1).max(10_000),

    concept: z.string().trim().min(1).max(200).default("general"),
  })
  .strict();

const memorySearchBodySchema = z
  .object({
    query: z.string().trim().min(1).max(4_000),

    memoryTypes: z.array(memoryTypeSchema).min(1).optional(),

    limit: z.number().int().min(1).max(100).default(5),

    minImportance: z.number().min(0).max(1).optional(),
  })
  .strict();

const reportBodySchema = z
  .object({
    saveToFile: z.boolean().default(true),

    memorySummaryLimit: z.number().int().min(1).max(100).default(10),
  })
  .strict();

function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);

  if (!result.success) {
    throw new ApiError(400, "VALIDATION_ERROR", z.prettifyError(result.error));
  }

  return result.data;
}

function createSafePdfFileName(originalFileName: string): string {
  const baseName = basename(originalFileName);

  const extension = extname(baseName);

  if (extension.toLowerCase() !== ".pdf") {
    throw new ApiError(415, "UNSUPPORTED_MEDIA_TYPE", "只允许上传 .pdf 文件");
  }

  const rawStem = basename(baseName, extension).normalize("NFKC");

  const safeStem = rawStem
    .replace(/[^\p{L}\p{N}._-]+/gu, "_")
    .replace(/^[._-]+|[._-]+$/gu, "")
    .slice(0, 80);

  return `${safeStem || "document"}.pdf`;
}

function mapDocumentConversionError(error: DocumentConversionError): ApiError {
  switch (error.code) {
    case "FILE_NOT_FOUND":
      return new ApiError(404, error.code, error.message, {
        cause: error,
      });

    case "FILE_TOO_LARGE":
      return new ApiError(413, error.code, error.message, {
        cause: error,
      });

    case "UNSUPPORTED_FILE_TYPE":
      return new ApiError(415, error.code, error.message, {
        cause: error,
      });

    case "PATH_OUTSIDE_ROOT":
      return new ApiError(400, error.code, error.message, {
        cause: error,
      });

    default:
      return new ApiError(422, error.code, error.message, {
        cause: error,
      });
  }
}

function readErrorStatusCode(error: unknown): number | undefined {
  if (!error || typeof error !== "object" || !("statusCode" in error)) {
    return undefined;
  }

  const statusCode = error.statusCode;

  return typeof statusCode === "number" ? statusCode : undefined;
}

function readErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("code" in error)) {
    return undefined;
  }

  return typeof error.code === "string" ? error.code : undefined;
}

function readErrorMessage(error: unknown): string {
  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }

  return "请求参数不合法";
}

function discardMultipartFile(part: MultipartFile): void {
  /*
   * 拒绝上传后仍要消费文件流，否则 multipart 请求可能无法正常结束。
   */
  part.file.resume();
}

export const assistantRoutes: FastifyPluginAsync<
  AssistantRoutesOptions
> = async (app, options): Promise<void> => {
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof DocumentConversionError) {
      const mapped = mapDocumentConversionError(error);

      return reply.status(mapped.statusCode).send({
        success: false,

        error: {
          code: mapped.code,

          message: mapped.message,

          requestId: request.id,
        },
      });
    }

    if (error instanceof ApiError) {
      return reply.status(error.statusCode).send({
        success: false,

        error: {
          code: error.code,

          message: readErrorMessage(error),

          requestId: request.id,
        },
      });
    }

    const pluginStatusCode = readErrorStatusCode(error);

    if (
      pluginStatusCode !== undefined &&
      pluginStatusCode >= 400 &&
      pluginStatusCode < 500
    ) {
      return reply.status(pluginStatusCode).send({
        success: false,

        error: {
          code: readErrorCode(error) ?? "INVALID_REQUEST",

          message: readErrorMessage(error),

          requestId: request.id,
        },
      });
    }

    request.log.error(
      {
        err: error,
      },
      "Assistant API 请求处理失败",
    );

    return reply.status(500).send({
      success: false,

      error: {
        code: "INTERNAL_SERVER_ERROR",

        message: "服务器处理请求失败",

        requestId: request.id,
      },
    });
  });

  app.post("/documents/pdf", async (request, reply) => {
    const part = await request.file();

    if (!part) {
      throw new ApiError(400, "PDF_FILE_REQUIRED", "请求中缺少 PDF 文件");
    }

    if (part.fieldname !== "file") {
      discardMultipartFile(part);

      throw new ApiError(
        400,
        "INVALID_FILE_FIELD",
        'PDF 文件字段名必须是 "file"',
      );
    }

    if (part.mimetype !== "application/pdf") {
      discardMultipartFile(part);

      throw new ApiError(
        415,
        "UNSUPPORTED_MEDIA_TYPE",
        "文件 Content-Type 必须是 application/pdf",
      );
    }

    let fileName: string;

    try {
      fileName = createSafePdfFileName(part.filename);
    } catch (error: unknown) {
      discardMultipartFile(part);

      throw error;
    }

    const uploadDirectory = join(options.uploadRoot, randomUUID());

    await mkdir(uploadDirectory, {
      recursive: false,
    });

    const filePath = join(uploadDirectory, fileName);

    let result: Awaited<ReturnType<AssistantHttpApi["loadPdf"]>>;

    try {
      await pipeline(
        part.file,
        createWriteStream(filePath, {
          flags: "wx",
        }),
      );

      if (part.file.truncated) {
        throw new ApiError(
          413,
          "PDF_FILE_TOO_LARGE",
          [
            "PDF 文件超过大小限制。",
            `最大允许 ${options.maxUploadBytes} 字节。`,
          ].join(""),
        );
      }

      result = await options.assistant.loadPdf(filePath);
    } finally {
      /*
       * loadPdf() 已把 PDF 内容转换并摄取到 RAG。
       * 原始上传文件不再需要，删除临时目录。
       */
      await rm(uploadDirectory, {
        recursive: true,
        force: true,
      });
    }

    /*
     * 必须等临时目录清理完成后再发送响应。
     * reply.send() 会立即启动响应发送，不能放在上面的 try 中。
     */
    return reply.status(201).send({
      success: true,

      data: result,
    });
  });

  app.post("/questions", async (request, reply) => {
    const input = parseBody(questionBodySchema, request.body);

    if (!options.assistant.getCurrentDocument()) {
      throw new ApiError(409, "NO_DOCUMENT_LOADED", "请先上传并加载 PDF 文档");
    }

    const result = await options.assistant.ask(input.question, {
      scope: input.scope,

      useAdvancedSearch: input.useAdvancedSearch,

      limit: input.limit,

      maxContextCharacters: input.maxContextCharacters,

      ...(input.enableMqe === undefined
        ? {}
        : {
            enableMqe: input.enableMqe,
          }),

      ...(input.enableHyde === undefined
        ? {}
        : {
            enableHyde: input.enableHyde,
          }),

      ...(input.minScore === undefined
        ? {}
        : {
            minScore: input.minScore,
          }),
    });

    return reply.send({
      success: true,

      data: result,
    });
  });

  app.post("/chat", async (request, reply) => {
    const input = parseBody(chatBodySchema, request.body);

    const result = await options.assistant.chat(input.message);

    return reply.send({
      success: true,

      data: result,
    });
  });

  app.post("/notes", async (request, reply) => {
    const input = parseBody(noteBodySchema, request.body);

    const memoryId = await options.assistant.addNote(
      input.content,
      input.concept,
    );

    return reply.status(201).send({
      success: true,

      data: {
        memoryId,
      },
    });
  });

  app.post("/memories/search", async (request, reply) => {
    const input = parseBody(memorySearchBodySchema, request.body);

    const results = await options.assistant.recall(input.query, {
      limit: input.limit,

      ...(input.memoryTypes === undefined
        ? {}
        : {
            memoryTypes: input.memoryTypes,
          }),

      ...(input.minImportance === undefined
        ? {}
        : {
            minImportance: input.minImportance,
          }),
    });

    return reply.send({
      success: true,

      data: {
        count: results.length,

        results,
      },
    });
  });

  app.get("/stats", async () => {
    const stats = await options.assistant.getStats();

    return {
      success: true,

      data: stats,
    };
  });

  app.post("/reports", async (request, reply) => {
    const input = parseBody(reportBodySchema, request.body ?? {});

    const result = await options.assistant.generateReport(input);

    return reply.status(201).send({
      success: true,

      data: result,
    });
  });
};
