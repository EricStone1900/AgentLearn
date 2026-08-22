import {
  useCallback,
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
  AssistantStats,
  SearchMemoriesResult,
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
    : "操作失败，请稍后重试";
}

function formatDateTime(value: string): string {
  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString("zh-CN");
}

export interface LearningProgressProps {
  api: Pick<AssistantApi, "getStats" | "searchMemories">;
  /** 上传、问答或笔记成功后改变该值，即可触发统计重新读取。 */
  refreshKey?: number;
}

/**
 * 统计与记忆检索使用独立状态：刷新统计失败不应影响用户搜索记忆，反之亦然。
 */
export function LearningProgress(props: LearningProgressProps) {
  const [stats, setStats] = useState<AssistantStats | undefined>(undefined);
  const [statsError, setStatsError] = useState<string | undefined>(undefined);
  const [isLoadingStats, setIsLoadingStats] = useState(true);
  const [query, setQuery] = useState("");
  const [searchResult, setSearchResult] = useState<SearchMemoriesResult | undefined>(undefined);
  const [searchError, setSearchError] = useState<string | undefined>(undefined);
  const [isSearching, setIsSearching] = useState(false);
  const statsAbortControllerRef = useRef<AbortController | undefined>(undefined);
  const searchAbortControllerRef = useRef<AbortController | undefined>(undefined);

  const loadStats = useCallback(async (): Promise<void> => {
    statsAbortControllerRef.current?.abort();

    const controller = new AbortController();
    statsAbortControllerRef.current = controller;
    setIsLoadingStats(true);
    setStatsError(undefined);

    try {
      const nextStats = await props.api.getStats(controller.signal);
      setStats(nextStats);
    } catch (error: unknown) {
      if (error instanceof ApiClientError && error.kind === "aborted") {
        return;
      }

      setStatsError(toErrorMessage(error));
    } finally {
      if (statsAbortControllerRef.current === controller) {
        statsAbortControllerRef.current = undefined;
        setIsLoadingStats(false);
      }
    }
  }, [props.api]);

  useEffect(() => {
    void loadStats();

    return () => {
      statsAbortControllerRef.current?.abort();
      searchAbortControllerRef.current?.abort();
    };
  }, [loadStats, props.refreshKey]);

  async function handleSearchSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    const normalizedQuery = query.trim();

    if (!normalizedQuery || isSearching) {
      return;
    }

    const controller = new AbortController();
    searchAbortControllerRef.current?.abort();
    searchAbortControllerRef.current = controller;
    setIsSearching(true);
    setSearchError(undefined);
    setSearchResult(undefined);

    try {
      const result = await props.api.searchMemories(
        {
          query: normalizedQuery,
          limit: 10,
        },
        controller.signal,
      );
      setSearchResult(result);
    } catch (error: unknown) {
      if (error instanceof ApiClientError && error.kind === "aborted") {
        return;
      }

      setSearchError(toErrorMessage(error));
    } finally {
      if (searchAbortControllerRef.current === controller) {
        searchAbortControllerRef.current = undefined;
        setIsSearching(false);
      }
    }
  }

  return (
    <section
      className="learning-progress"
      aria-labelledby="learning-progress-title"
      aria-busy={isLoadingStats || isSearching}
    >
      <div className="section-heading">
        <p className="eyebrow">04 · 学习进度</p>
        <h2 id="learning-progress-title">会话统计与记忆检索</h2>
        <p>查看当前学习会话状态，并检索之前保存的笔记和学习记录。</p>
      </div>

      <div className="learning-progress-grid">
        <div className="progress-panel">
          <div className="panel-heading">
            <h3>当前会话</h3>
            <button
              type="button"
              className="secondary-button"
              disabled={isLoadingStats}
              onClick={() => void loadStats()}
            >
              {isLoadingStats ? "正在刷新…" : "刷新统计"}
            </button>
          </div>

          {statsError ? <p className="status-message status-error" role="alert">{statsError}</p> : null}

          {stats ? (
            <>
              <dl className="metrics-grid">
                <div><dt>已加载文档</dt><dd>{stats.metrics.documentsLoaded}</dd></div>
                <div><dt>已提问</dt><dd>{stats.metrics.questionsAsked}</dd></div>
                <div><dt>已保存笔记</dt><dd>{stats.metrics.notesAdded}</dd></div>
                <div><dt>Agent 交互</dt><dd>{stats.metrics.agentInteractions}</dd></div>
                <div><dt>知识库文档</dt><dd>{stats.rag.documents}</dd></div>
                <div><dt>知识库切片</dt><dd>{stats.rag.chunks}</dd></div>
              </dl>

              <p className="current-document-status">
                {stats.currentDocument
                  ? `当前文档：${stats.currentDocument.title}（${stats.currentDocument.chunkCount} 个切片）`
                  : "当前尚未加载文档"}
              </p>
            </>
          ) : null}
        </div>

        <div className="progress-panel">
          <h3>检索学习记忆</h3>
          <form className="memory-search-form" onSubmit={handleSearchSubmit}>
            <label htmlFor="memory-search-query">检索内容</label>
            <input
              id="memory-search-query"
              value={query}
              maxLength={4_000}
              placeholder="例如：RAG 的关键概念"
              disabled={isSearching}
              onChange={(event) => setQuery(event.target.value)}
            />
            <button type="submit" className="secondary-button" disabled={!query.trim() || isSearching}>
              {isSearching ? "正在检索…" : "搜索学习记忆"}
            </button>
          </form>

          {searchError ? <p className="status-message status-error" role="alert">{searchError}</p> : null}

          {searchResult ? (
            <div className="memory-search-results" aria-live="polite">
              <p className="field-hint">找到 {searchResult.count} 条相关记忆。</p>
              {searchResult.results.length === 0 ? (
                <p className="empty-state">暂无匹配的学习记忆。</p>
              ) : (
                <ol>
                  {searchResult.results.map((result) => {
                    return (
                      <li key={result.item.id}>
                        <p>{result.item.content}</p>
                        <small>
                          {result.item.memoryType} · 相关度 {result.score.toFixed(3)} · {formatDateTime(result.item.timestamp)}
                        </small>
                      </li>
                    );
                  })}
                </ol>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
