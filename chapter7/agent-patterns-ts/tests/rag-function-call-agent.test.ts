import type {
  ChatCompletion,
  ChatCompletionMessage,
} from "openai/resources/chat/completions";
import { describe, expect, it, vi } from "vitest";
import { FunctionCallAgent } from "../src/agents/function-call/function-call-agent.js";
import type {
  NativeToolCallingLlmClient,
  NativeToolCompletionRequest,
} from "../src/core/native-tool-calling.js";
import type { MessageData } from "../src/core/types.js";
import type { RagToolService } from "../src/tools/rag-tool.js";
import { createRagTool } from "../src/tools/rag-tool.js";
import { ToolRegistry } from "../src/tools/tool.js";

function completion(
  message: ChatCompletionMessage,
  finishReason: "tool_calls" | "stop",
): ChatCompletion {
  return {
    id: `completion-${finishReason}`,
    object: "chat.completion",
    created: 0,
    model: "fake-native-llm",
    choices: [{
      index: 0,
      finish_reason: finishReason,
      logprobs: null,
      message,
    }],
  };
}

class FakeNativeRagLlm implements NativeToolCallingLlmClient {
  public readonly provider = "fake";
  public readonly model = "fake-native-llm";
  public readonly requests: NativeToolCompletionRequest[] = [];
  private readonly completions: ChatCompletion[] = [
    completion({
      role: "assistant",
      content: null,
      refusal: null,
      tool_calls: [{
        id: "rag-call-1",
        type: "function",
        function: {
          name: "rag",
          arguments: JSON.stringify({
            action: "search",
            namespace: "docs",
            query: "RAG 如何工作",
            limit: 3,
          }),
        },
      }],
    }, "tool_calls"),
    completion({
      role: "assistant",
      content: "RAG 会先检索相关片段，再根据证据生成答案。",
      refusal: null,
    }, "stop"),
  ];

  public async generate(_messages: MessageData[]): Promise<string> {
    throw new Error("本测试不应调用 generate");
  }

  public async createToolCompletion(
    request: NativeToolCompletionRequest,
  ): Promise<ChatCompletion> {
    this.requests.push(structuredClone(request));
    const next = this.completions.shift();
    if (!next) throw new Error("Fake completion 已耗尽");
    return next;
  }
}

function createFakeRagService(): RagToolService {
  return {
    ingestText: vi.fn(async () => ({
      documentId: "doc-1",
      chunkCount: 1,
      replaced: false,
    })),
    ingestFile: vi.fn(async () => ({
      documentId: "doc-1",
      chunkCount: 1,
      replaced: false,
    })),
    search: vi.fn(async () => [{
      document: {
        id: "doc-1",
        namespace: "docs",
        source: "guide.md",
        title: "RAG Guide",
        markdown: "完整文档不应该进入 Agent 工具结果",
        contentHash: "document-hash",
        indexFingerprint: "index-v1",
        metadata: {},
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      chunk: {
        id: "chunk-1",
        documentId: "doc-1",
        namespace: "docs",
        chunkIndex: 0,
        content: "RAG 会先检索相关片段。",
        embeddingText: "RAG 检索 片段",
        headingPath: "工作流程",
        startOffset: 10,
        endOffset: 22,
        tokenCount: 10,
        contentHash: "chunk-hash",
        metadata: {},
      },
      score: 0.94,
    }]),
    ask: vi.fn(async () => ({ answer: "回答", citations: [] })),
    deleteDocument: vi.fn(async () => true),
    getStats: vi.fn(async () => ({ documents: 1, chunks: 1 })),
  };
}

describe("FunctionCallAgent RAG integration", () => {
  it("完成模型调用 RAGTool、接收片段并生成最终回答的闭环", async () => {
    const llm = new FakeNativeRagLlm();
    const ragService = createFakeRagService();
    const registry = new ToolRegistry();
    registry.register(createRagTool(ragService));
    const agent = new FunctionCallAgent({
      name: "RAG 助手",
      llm,
      toolRegistry: registry,
      systemPrompt: "回答文档问题前先检索知识库。",
    });

    const result = await agent.run("请说明 RAG 如何工作");

    expect(result).toEqual({
      answer: "RAG 会先检索相关片段，再根据证据生成答案。",
      steps: 2,
    });
    expect(ragService.search).toHaveBeenCalledWith("RAG 如何工作", {
      namespace: "docs",
      limit: 3,
      enableMqe: false,
      enableHyde: false,
    });
    expect(llm.requests).toHaveLength(2);
    expect(llm.requests[0]?.tools
      .filter((tool) => tool.type === "function")
      .map((tool) => tool.function.name))
      .toContain("rag");

    const toolMessage = llm.requests[1]?.messages.find(
      (message) => message.role === "tool",
    );
    expect(toolMessage?.content).toContain("RAG 会先检索相关片段");
    expect(toolMessage?.content).not.toContain("完整文档不应该进入 Agent 工具结果");
    expect(agent.getHistory().map((message) => message.role))
      .toEqual(["user", "assistant"]);
  });
});
