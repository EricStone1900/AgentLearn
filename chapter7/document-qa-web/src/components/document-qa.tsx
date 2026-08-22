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
  AskDocumentResult,
  CurrentDocument,
} from "../api/contracts.js";

const MAX_QUESTION_LENGTH = 4_000;

export interface DocumentQaProps {
  api: Pick<AssistantApi, "askDocument">;
  currentDocument?: CurrentDocument | undefined;
  onAnswered?(result: AskDocumentResult): void;
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
    : "提问失败，请稍后重试";
}

function formatScore(score: number): string {
  return score.toFixed(3);
}

/**
 * 当前文档的单轮问答界面。
 *
 * 回答由后端 RAG 服务生成；前端不自行拼接上下文或生成答案，
 * 仅负责收集问题、呈现引用，并保留后端给出的警告信息。
 */
export function DocumentQa(props: DocumentQaProps) {
  const [question, setQuestion] = useState("");
  const [result, setResult] = useState<AskDocumentResult | undefined>(undefined);
  const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined);
  const [isAsking, setIsAsking] = useState(false);
  const abortControllerRef = useRef<AbortController | undefined>(undefined);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    /* 切换文档后，旧答案不能再被误认为属于新文档。 */
    setResult(undefined);
    setErrorMessage(undefined);
  }, [props.currentDocument?.documentId]);

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();

    const normalizedQuestion = question.trim();

    if (!props.currentDocument || isAsking) {
      return;
    }

    if (!normalizedQuestion) {
      setErrorMessage("请输入要询问文档的问题");
      return;
    }

    const controller = new AbortController();

    abortControllerRef.current = controller;
    setIsAsking(true);
    setErrorMessage(undefined);
    setResult(undefined);

    try {
      const askResult = await props.api.askDocument(
        {
          question: normalizedQuestion,
          scope: "current_document",
          useAdvancedSearch: true,
        },
        controller.signal,
      );

      setResult(askResult);
      props.onAnswered?.(askResult);
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

      setIsAsking(false);
    }
  }

  const currentDocument = props.currentDocument;
  const isReady = currentDocument !== undefined;

  return (
    <section
      className="document-qa"
      aria-labelledby="document-qa-title"
      aria-busy={isAsking}
    >
      <div className="section-heading">
        <p className="eyebrow">02 · 文档问答</p>
        <h2 id="document-qa-title">向当前文档提问</h2>
        <p>
          {currentDocument
            ? `正在检索：《${currentDocument.title}》`
            : "请先上传并加载一份 PDF 文档。"}
        </p>
      </div>

      <form className="question-form" onSubmit={handleSubmit}>
        <label htmlFor="document-question">你的问题</label>
        <textarea
          id="document-question"
          value={question}
          maxLength={MAX_QUESTION_LENGTH}
          placeholder="例如：请概括这份文档中 RAG 的工作流程。"
          disabled={!isReady || isAsking}
          onChange={(event) => {
            setQuestion(event.target.value);
          }}
        />

        <div className="question-form-footer">
          <span className="field-hint">
            {question.length}/{MAX_QUESTION_LENGTH}
          </span>

          <button
            type="submit"
            className="primary-button"
            disabled={!isReady || !question.trim() || isAsking}
          >
            {isAsking ? "正在检索并生成回答…" : "开始问答"}
          </button>
        </div>
      </form>

      {errorMessage ? (
        <p className="status-message status-error" role="alert">
          {errorMessage}
        </p>
      ) : null}

      {result ? (
        <article className="answer-result" aria-live="polite">
          <h3>回答</h3>
          <p className="answer-content">{result.answer}</p>

          {result.citations.length > 0 ? (
            <div className="citation-list">
              <h4>引用来源</h4>
              <ol>
                {result.citations.map((citation) => {
                  return (
                    <li key={`${citation.documentId}-${citation.index}`}>
                      <span>{citation.source}</span>
                      <span>
                        片段 #{citation.index} · 相关度 {formatScore(citation.score)}
                      </span>
                    </li>
                  );
                })}
              </ol>
            </div>
          ) : null}

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
        </article>
      ) : null}
    </section>
  );
}
