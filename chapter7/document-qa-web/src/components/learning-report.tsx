import {
  useEffect,
  useRef,
  useState,
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
  GenerateReportResult,
} from "../api/contracts.js";

function toErrorMessage(error: unknown): string {
  if (isApiClientError(error)) {
    const requestId = error.requestId
      ? `（请求 ID：${error.requestId}）`
      : "";

    return `${error.message}${requestId}`;
  }

  return error instanceof Error
    ? error.message
    : "生成学习报告失败，请稍后重试";
}

function formatDateTime(value: string): string {
  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString("zh-CN");
}

export interface LearningReportProps {
  api: Pick<AssistantApi, "generateReport">;
}

/**
 * 报告仅在浏览器内展示。
 * saveToFile 固定为 false，避免将后端主机上的文件路径当作浏览器可访问链接。
 */
export function LearningReport(props: LearningReportProps) {
  const [memorySummaryLimit, setMemorySummaryLimit] = useState(10);
  const [result, setResult] = useState<GenerateReportResult | undefined>(undefined);
  const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined);
  const [isGenerating, setIsGenerating] = useState(false);
  const abortControllerRef = useRef<AbortController | undefined>(undefined);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (isGenerating) {
      return;
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;
    setIsGenerating(true);
    setErrorMessage(undefined);

    try {
      const nextResult = await props.api.generateReport(
        {
          saveToFile: false,
          memorySummaryLimit,
        },
        controller.signal,
      );
      setResult(nextResult);
    } catch (error: unknown) {
      if (error instanceof ApiClientError && error.kind === "aborted") {
        return;
      }

      setErrorMessage(toErrorMessage(error));
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = undefined;
      }

      setIsGenerating(false);
    }
  }

  return (
    <section
      className="learning-report"
      aria-labelledby="learning-report-title"
      aria-busy={isGenerating}
    >
      <div className="section-heading">
        <p className="eyebrow">05 · 学习报告</p>
        <h2 id="learning-report-title">总结本次学习</h2>
        <p>基于本会话的文档、问答、笔记和记忆生成概览，报告只在当前页面展示。</p>
      </div>

      <form className="report-form" onSubmit={handleSubmit}>
        <label htmlFor="memory-summary-limit">报告中保留的记忆条数</label>
        <input
          id="memory-summary-limit"
          type="number"
          min={1}
          max={100}
          value={memorySummaryLimit}
          disabled={isGenerating}
          onChange={(event) => {
            const parsed = Number(event.target.value);

            if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 100) {
              setMemorySummaryLimit(parsed);
            }
          }}
        />
        <button type="submit" className="primary-button" disabled={isGenerating}>
          {isGenerating ? "正在生成报告…" : "生成学习报告"}
        </button>
      </form>

      {errorMessage ? <p className="status-message status-error" role="alert">{errorMessage}</p> : null}

      {result ? (
        <article className="report-result" aria-live="polite">
          <div className="report-heading">
            <h3>本次学习报告</h3>
            <p>生成时间：{formatDateTime(result.report.generatedAt)}</p>
          </div>

          <dl className="metrics-grid">
            <div><dt>学习时长</dt><dd>{result.report.session.durationSeconds} 秒</dd></div>
            <div><dt>已加载文档</dt><dd>{result.report.metrics.documentsLoaded}</dd></div>
            <div><dt>已提问</dt><dd>{result.report.metrics.questionsAsked}</dd></div>
            <div><dt>已保存笔记</dt><dd>{result.report.metrics.notesAdded}</dd></div>
            <div><dt>知识库文档</dt><dd>{result.report.rag.documents}</dd></div>
            <div><dt>知识库切片</dt><dd>{result.report.rag.chunks}</dd></div>
          </dl>

          <p className="current-document-status">
            {result.report.currentDocument
              ? `本次学习文档：${result.report.currentDocument.title}`
              : "本次会话尚未加载文档"}
          </p>

          <div className="report-memory-summary">
            <h4>记忆摘要</h4>
            {result.report.memorySummary.length === 0 ? (
              <p className="empty-state">当前没有可写入报告的学习记忆。</p>
            ) : (
              <ol>
                {result.report.memorySummary.map((memory) => {
                  return (
                    <li key={memory.id}>
                      <p>{memory.content}</p>
                      <small>{memory.memoryType} · 重要度 {memory.importance.toFixed(2)}</small>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
        </article>
      ) : null}
    </section>
  );
}
