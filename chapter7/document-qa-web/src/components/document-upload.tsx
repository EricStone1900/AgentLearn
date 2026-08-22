import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import {
  ApiClientError,
  isApiClientError,
} from "../api/api-error.js";
import type {
  AssistantApi,
} from "../api/assistant-api.js";
import type {
  LoadPdfResult,
} from "../api/contracts.js";

export interface DocumentUploadProps {
  api: Pick<AssistantApi, "uploadPdf">;
  maxUploadBytes: number;
  onUploaded?(result: LoadPdfResult): void;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function validatePdfFile(
  file: File,
  maxUploadBytes: number,
): string | undefined {
  if (!file.name.toLowerCase().endsWith(".pdf")) {
    return "请选择 .pdf 格式的文件";
  }

  if (file.type && file.type !== "application/pdf") {
    return "文件 MIME 类型不是 application/pdf";
  }

  if (file.size > maxUploadBytes) {
    return [
      "文件超过前端大小限制。",
      `当前：${formatFileSize(file.size)}。`,
      `最大：${formatFileSize(maxUploadBytes)}。`,
    ].join("");
  }

  return undefined;
}

function toErrorMessage(error: unknown): string {
  if (isApiClientError(error)) {
    const requestId = error.requestId
      ? `（请求 ID：${error.requestId}）`
      : "";

    return `${error.message}${requestId}`;
  }

  return error instanceof Error
    ? error.message
    : "上传失败，请稍后重试";
}

export function DocumentUpload(
  props: DocumentUploadProps,
) {
  const [file, setFile] = useState<File | undefined>(undefined);
  const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined);
  const [result, setResult] = useState<LoadPdfResult | undefined>(undefined);
  const [isUploading, setIsUploading] = useState(false);
  const abortControllerRef = useRef<AbortController | undefined>(undefined);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  function handleFileChange(
    event: ChangeEvent<HTMLInputElement>,
  ): void {
    const nextFile = event.target.files?.[0] ?? undefined;

    setResult(undefined);

    if (!nextFile) {
      setFile(undefined);
      setErrorMessage(undefined);
      return;
    }

    const validationError = validatePdfFile(
      nextFile,
      props.maxUploadBytes,
    );

    if (validationError) {
      setFile(undefined);
      setErrorMessage(validationError);
      event.target.value = "";
      return;
    }

    setFile(nextFile);
    setErrorMessage(undefined);
  }

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();

    if (!file || isUploading) {
      return;
    }

    const controller = new AbortController();

    abortControllerRef.current = controller;
    setIsUploading(true);
    setErrorMessage(undefined);
    setResult(undefined);

    try {
      const uploadResult = await props.api.uploadPdf(
        {
          file,
        },
        controller.signal,
      );

      setResult(uploadResult);
      props.onUploaded?.(uploadResult);
    } catch (error: unknown) {
      if (
        error instanceof ApiClientError &&
        error.kind === "aborted"
      ) {
        return;
      }

      setErrorMessage(toErrorMessage(error));
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = undefined;
      }

      setIsUploading(false);
    }
  }

  return (
    <section
      className="document-upload"
      aria-labelledby="document-upload-title"
      aria-busy={isUploading}
    >
      <div className="section-heading">
        <p className="eyebrow">01 · 文档准备</p>
        <h2 id="document-upload-title">上传 PDF</h2>
        <p>上传后会提取文本、切分内容并写入当前知识库。</p>
      </div>

      <form onSubmit={handleSubmit} className="upload-form">
        <label className="file-picker">
          <span>选择 PDF 文件</span>
          <input
            type="file"
            accept="application/pdf,.pdf"
            onChange={handleFileChange}
            disabled={isUploading}
          />
        </label>

        <p className="field-hint">
          最大 {formatFileSize(props.maxUploadBytes)}。后端会再次验证文件签名、页数和文本内容。
        </p>

        {file ? (
          <p className="selected-file" aria-live="polite">
            已选择：<strong>{file.name}</strong>（{formatFileSize(file.size)}）
          </p>
        ) : null}

        {errorMessage ? (
          <p className="status-message status-error" role="alert">
            {errorMessage}
          </p>
        ) : null}

        <button
          type="submit"
          className="primary-button"
          disabled={!file || isUploading}
        >
          {isUploading ? "正在上传并处理…" : "上传并加载文档"}
        </button>
      </form>

      {result ? (
        <div className="upload-result" aria-live="polite">
          <p className="status-message status-success">文档已加载到知识库。</p>

          <dl className="document-summary">
            <div>
              <dt>标题</dt>
              <dd>{result.document.title}</dd>
            </div>
            <div>
              <dt>页数</dt>
              <dd>{result.document.pageCount}</dd>
            </div>
            <div>
              <dt>切片数</dt>
              <dd>{result.document.chunkCount}</dd>
            </div>
            <div>
              <dt>处理时间</dt>
              <dd>{result.durationMs} ms</dd>
            </div>
          </dl>

          {result.warnings.length > 0 ? (
            <div className="warning-list">
              <p>以下辅助操作未完成：</p>
              <ul>
                {result.warnings.map((warning) => {
                  return <li key={warning}>{warning}</li>;
                })}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
