// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  afterEach,
  describe,
  expect,
  it,
  vi,
  type MockedFunction,
} from "vitest";
import {
  ApiClientError,
} from "../../src/api/api-error.js";
import type {
  AssistantApi,
} from "../../src/api/assistant-api.js";
import {
  DocumentUpload,
} from "../../src/components/document-upload.js";

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

function createUploadResult() {
  return {
    document: {
      documentId: "doc-1",
      title: "RAG Guide",
      source: "rag-guide.pdf",
      pageCount: 2,
      chunkCount: 4,
      loadedAt: "2026-08-22T00:00:00.000Z",
    },
    ingestion: {
      documentId: "doc-1",
      chunkCount: 4,
      replaced: false,
    },
    durationMs: 120,
    warnings: [],
  };
}

function renderDocumentUpload(
  uploadPdf: MockedFunction<AssistantApi["uploadPdf"]>,
  maxUploadBytes = MAX_UPLOAD_BYTES,
) {
  return render(
    <DocumentUpload
      api={{
        uploadPdf,
      }}
      maxUploadBytes={maxUploadBytes}
    />,
  );
}

function selectFile(file: File): void {
  fireEvent.change(
    screen.getByLabelText("选择 PDF 文件"),
    {
      target: {
        files: [file],
      },
    },
  );
}

describe("DocumentUpload", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("拒绝非 PDF 文件，不发送上传请求", () => {
    const uploadPdf: MockedFunction<AssistantApi["uploadPdf"]> =
      vi.fn<AssistantApi["uploadPdf"]>();

    renderDocumentUpload(uploadPdf);

    selectFile(
      new File(["plain text"], "notes.txt", {
        type: "text/plain",
      }),
    );

    expect(screen.getByRole("alert").textContent).toContain(
      "请选择 .pdf 格式的文件",
    );

    expect((screen.getByRole("button", {
      name: "上传并加载文档",
    }) as HTMLButtonElement).disabled).toBe(true);

    expect(uploadPdf).not.toHaveBeenCalled();
  });

  it("拒绝超过前端限制的 PDF 文件", () => {
    const uploadPdf: MockedFunction<AssistantApi["uploadPdf"]> =
      vi.fn<AssistantApi["uploadPdf"]>();

    renderDocumentUpload(uploadPdf, 10);

    selectFile(
      new File(
        [new Uint8Array(11)],
        "large.pdf",
        {
          type: "application/pdf",
        },
      ),
    );

    expect(screen.getByRole("alert").textContent).toContain(
      "文件超过前端大小限制",
    );

    expect(uploadPdf).not.toHaveBeenCalled();
  });

  it("上传成功后展示文档摘要和后端 warnings", async () => {
    const uploadPdf: MockedFunction<AssistantApi["uploadPdf"]> =
      vi.fn<AssistantApi["uploadPdf"]>();

    uploadPdf.mockResolvedValueOnce({
      ...createUploadResult(),
      warnings: ["记忆记录失败：memory backend unavailable"],
    });

    renderDocumentUpload(uploadPdf);

    const file = new File(["%PDF-1.4"], "rag-guide.pdf", {
      type: "application/pdf",
    });

    selectFile(file);

    fireEvent.click(
      screen.getByRole("button", {
        name: "上传并加载文档",
      }),
    );

    await waitFor(() => {
      expect(uploadPdf).toHaveBeenCalledWith(
        {
          file,
        },
        expect.any(AbortSignal),
      );
    });

    expect(await screen.findByText("文档已加载到知识库。")).not.toBeNull();

    expect(screen.getByText("RAG Guide")).not.toBeNull();
    expect(screen.getByText("4")).not.toBeNull();
    expect(screen.getByText("记忆记录失败：memory backend unavailable")).not.toBeNull();
  });

  it("展示后端错误消息和请求 ID", async () => {
    const uploadPdf: MockedFunction<AssistantApi["uploadPdf"]> =
      vi.fn<AssistantApi["uploadPdf"]>();

    uploadPdf.mockRejectedValueOnce(
      new ApiClientError("PDF 页数超过限制", {
        kind: "api",
        status: 422,
        code: "PDF_TOO_MANY_PAGES",
        requestId: "request-123",
      }),
    );

    renderDocumentUpload(uploadPdf);

    selectFile(
      new File(["%PDF-1.4"], "long.pdf", {
        type: "application/pdf",
      }),
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "上传并加载文档",
      }),
    );

    expect((await screen.findByRole("alert")).textContent).toContain(
      "PDF 页数超过限制（请求 ID：request-123）",
    );
  });
});
