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

type ConversationMessage =
  | {
      role: "user";
      content: string;
    }
  | {
      role: "assistant";
      content: string;
      steps: number;
    };

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

/**
 * 学习会话区：聊天与笔记是两个独立 API 操作，分别维护加载状态，
 * 避免保存笔记时阻塞用户继续与 Agent 对话。
 */
export interface LearningAssistantProps extends Pick<AssistantApi, "chat" | "addNote"> {
  /** 成功交互后通知页面刷新会话统计。 */
  onActivity?(): void;
}

export function LearningAssistant(props: LearningAssistantProps) {
  const [message, setMessage] = useState("");
  const [conversation, setConversation] = useState<ConversationMessage[]>([]);
  const [chatError, setChatError] = useState<string | undefined>(undefined);
  const [isChatting, setIsChatting] = useState(false);
  const [noteContent, setNoteContent] = useState("");
  const [noteConcept, setNoteConcept] = useState("");
  const [noteError, setNoteError] = useState<string | undefined>(undefined);
  const [savedMemoryId, setSavedMemoryId] = useState<string | undefined>(undefined);
  const [isSavingNote, setIsSavingNote] = useState(false);
  const chatAbortControllerRef = useRef<AbortController | undefined>(undefined);
  const noteAbortControllerRef = useRef<AbortController | undefined>(undefined);

  useEffect(() => {
    return () => {
      chatAbortControllerRef.current?.abort();
      noteAbortControllerRef.current?.abort();
    };
  }, []);

  async function handleChatSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    const normalizedMessage = message.trim();

    if (!normalizedMessage || isChatting) {
      return;
    }

    const controller = new AbortController();
    chatAbortControllerRef.current = controller;
    setIsChatting(true);
    setChatError(undefined);
    setConversation((previous) => [
      ...previous,
      { role: "user", content: normalizedMessage },
    ]);
    setMessage("");

    try {
      const result = await props.chat(
        {
          message: normalizedMessage,
        },
        controller.signal,
      );

      setConversation((previous) => [
        ...previous,
        {
          role: "assistant",
          content: result.answer,
          steps: result.steps,
        },
      ]);
      props.onActivity?.();
    } catch (error: unknown) {
      if (error instanceof ApiClientError && error.kind === "aborted") {
        return;
      }

      setChatError(toErrorMessage(error));
    } finally {
      if (chatAbortControllerRef.current === controller) {
        chatAbortControllerRef.current = undefined;
      }

      setIsChatting(false);
    }
  }

  async function handleNoteSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    const normalizedContent = noteContent.trim();
    const normalizedConcept = noteConcept.trim();

    if (!normalizedContent || isSavingNote) {
      return;
    }

    const controller = new AbortController();
    noteAbortControllerRef.current = controller;
    setIsSavingNote(true);
    setNoteError(undefined);
    setSavedMemoryId(undefined);

    try {
      const result = await props.addNote(
        {
          content: normalizedContent,
          ...(normalizedConcept ? { concept: normalizedConcept } : {}),
        },
        controller.signal,
      );

      setSavedMemoryId(result.memoryId);
      setNoteContent("");
      setNoteConcept("");
      props.onActivity?.();
    } catch (error: unknown) {
      if (error instanceof ApiClientError && error.kind === "aborted") {
        return;
      }

      setNoteError(toErrorMessage(error));
    } finally {
      if (noteAbortControllerRef.current === controller) {
        noteAbortControllerRef.current = undefined;
      }

      setIsSavingNote(false);
    }
  }

  return (
    <section
      className="learning-assistant"
      aria-labelledby="learning-assistant-title"
      aria-busy={isChatting || isSavingNote}
    >
      <div className="section-heading">
        <p className="eyebrow">03 · 学习助手</p>
        <h2 id="learning-assistant-title">追问与学习笔记</h2>
        <p>Agent 可使用知识检索和历史记忆协助学习；重要结论可以保存为笔记。</p>
      </div>

      <div className="learning-assistant-grid">
        <div className="assistant-panel">
          <h3>与学习助手对话</h3>
          <div className="conversation" aria-live="polite">
            {conversation.length === 0 ? (
              <p className="empty-state">例如：帮我制定学习这份资料的计划。</p>
            ) : (
              conversation.map((item, index) => {
                return (
                  <article className={`message message-${item.role}`} key={`${item.role}-${index}`}>
                    <strong>{item.role === "user" ? "你" : "学习助手"}</strong>
                    <p>{item.content}</p>
                    {item.role === "assistant" ? <small>Agent 步数：{item.steps}</small> : null}
                  </article>
                );
              })
            )}
          </div>

          <form className="assistant-form" onSubmit={handleChatSubmit}>
            <label htmlFor="assistant-message">追问</label>
            <textarea
              id="assistant-message"
              value={message}
              maxLength={8_000}
              placeholder="输入学习目标、追问或复习请求"
              disabled={isChatting}
              onChange={(event) => setMessage(event.target.value)}
            />
            <button type="submit" className="secondary-button" disabled={!message.trim() || isChatting}>
              {isChatting ? "学习助手正在思考…" : "发送给学习助手"}
            </button>
          </form>

          {chatError ? <p className="status-message status-error" role="alert">{chatError}</p> : null}
        </div>

        <div className="assistant-panel">
          <h3>保存学习笔记</h3>
          <form className="assistant-form" onSubmit={handleNoteSubmit}>
            <label htmlFor="note-content">笔记内容</label>
            <textarea
              id="note-content"
              value={noteContent}
              maxLength={10_000}
              placeholder="记录关键概念、疑问或自己的理解"
              disabled={isSavingNote}
              onChange={(event) => setNoteContent(event.target.value)}
            />
            <label htmlFor="note-concept">关联概念（可选）</label>
            <input
              id="note-concept"
              value={noteConcept}
              maxLength={200}
              placeholder="例如：RAG"
              disabled={isSavingNote}
              onChange={(event) => setNoteConcept(event.target.value)}
            />
            <button type="submit" className="secondary-button" disabled={!noteContent.trim() || isSavingNote}>
              {isSavingNote ? "正在保存笔记…" : "保存到学习记忆"}
            </button>
          </form>

          {savedMemoryId ? <p className="status-message status-success">笔记已保存（记忆 ID：{savedMemoryId}）。</p> : null}
          {noteError ? <p className="status-message status-error" role="alert">{noteError}</p> : null}
        </div>
      </div>
    </section>
  );
}
