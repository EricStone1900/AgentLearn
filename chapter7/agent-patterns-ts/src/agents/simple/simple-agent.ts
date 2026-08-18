import { Agent, type AgentOptions } from "../../core/agent.js";
import { Message } from "../../core/message.js";
import type { AgentResult, MessageData } from "../../core/types.js";
import type { ToolRegistry } from "../../tools/tool.js";

export interface SimpleAgentOptions extends AgentOptions {
  toolRegistry?: ToolRegistry;
  enableToolCalling?: boolean;
  maxToolIterations?: number;
}

interface ParsedToolCall {
  toolName: string;
  input: unknown;
  original: string;
}

export class SimpleAgent extends Agent {
  private toolRegistry: ToolRegistry | undefined;
  private readonly enableToolCalling: boolean;
  private readonly maxToolIterations: number;

  public constructor(options: SimpleAgentOptions) {
    super(options);

    this.toolRegistry = options.toolRegistry;

    this.enableToolCalling =
      (options.enableToolCalling ?? true) && options.toolRegistry !== undefined;

    this.maxToolIterations = options.maxToolIterations ?? 3;

    if (
      !Number.isInteger(this.maxToolIterations) ||
      this.maxToolIterations < 1
    ) {
      throw new Error("maxToolIterations 必须是正整数");
    }
  }

  private createSystemPrompt(): string {
    const basePrompt =
      this.systemPrompt ?? "你是一个友好、可靠且回答清晰的 AI 助手。";

    if (!this.enableToolCalling || !this.toolRegistry) {
      return basePrompt;
    }

    return [
      basePrompt,
      "",
      "## 可用工具",
      this.toolRegistry.describeWithSchemas(),
      "",
      "## 工具调用规则",
      "如果需要使用工具，必须单独输出以下格式：",
      '[TOOL_CALL:工具名称:{"参数名":"参数值"}]',
      "",
      "参数必须是合法 JSON。",
      "一次工具调用必须完整写在同一行。",
      "工具结果返回后，请根据结果继续回答。",
      "不需要工具时，直接返回最终答案。",
    ].join("\n");
  }

  private parseToolCalls(text: string): ParsedToolCall[] {
    const pattern = /\[TOOL_CALL:([A-Za-z0-9_-]+):(\{[^\n]*\})\]/g;

    const calls: ParsedToolCall[] = [];

    for (const match of text.matchAll(pattern)) {
      const original = match[0];
      const toolName = match[1];
      const rawArguments = match[2];

      if (
        original === undefined ||
        toolName === undefined ||
        rawArguments === undefined
      ) {
        continue;
      }

      let input: unknown;

      try {
        input = JSON.parse(rawArguments);
      } catch {
        input = {
          parseError: "工具参数不是合法 JSON",
          rawArguments,
        };
      }

      calls.push({
        toolName,
        input,
        original,
      });
    }

    return calls;
  }

  private saveConversation(inputText: string, answer: string): void {
    this.addMessage(new Message(inputText, "user"));
    this.addMessage(new Message(answer, "assistant"));
  }

  private async runWithoutTools(
    messages: MessageData[],
    inputText: string,
  ): Promise<AgentResult> {
    const answer = await this.llm.generate(messages, this.config.temperature);

    this.saveConversation(inputText, answer);

    return {
      answer,
      steps: 1,
    };
  }

  private async runWithTools(
    messages: MessageData[],
    inputText: string,
  ): Promise<AgentResult> {
    if (!this.toolRegistry) {
      return this.runWithoutTools(messages, inputText);
    }

    let llmCalls = 0;

    for (
      let iteration = 0;
      iteration < this.maxToolIterations;
      iteration += 1
    ) {
      const response = await this.llm.generate(
        messages,
        this.config.temperature,
      );

      llmCalls += 1;

      const toolCalls = this.parseToolCalls(response);

      if (toolCalls.length === 0) {
        this.saveConversation(inputText, response);

        return {
          answer: response,
          steps: llmCalls,
        };
      }

      const cleanResponse = toolCalls.reduce(
        (content, call) => content.replace(call.original, "").trim(),
        response,
      );

      messages.push({
        role: "assistant",
        content: cleanResponse,
      });

      const results: string[] = [];

      for (const toolCall of toolCalls) {
        const result = await this.toolRegistry.execute(
          toolCall.toolName,
          toolCall.input,
        );

        results.push(
          [`工具：${toolCall.toolName}`, `执行结果：${result}`].join("\n"),
        );
      }

      messages.push({
        role: "user",
        content: [
          "工具执行结果：",
          results.join("\n\n"),
          "",
          "请根据工具结果继续处理。",
          "如果信息已经足够，请直接给出最终答案。",
        ].join("\n"),
      });
    }

    /*
     * 达到最大工具调用次数后，
     * 强制要求模型给出最终答案。
     */
    messages.push({
      role: "user",
      content: [
        "已经达到最大工具调用次数。",
        "不要再调用工具，请根据已有信息给出最终答案。",
      ].join("\n"),
    });

    const finalAnswer = await this.llm.generate(
      messages,
      this.config.temperature,
    );

    llmCalls += 1;

    this.saveConversation(inputText, finalAnswer);

    return {
      answer: finalAnswer,
      steps: llmCalls,
    };
  }

  public async run(inputText: string): Promise<AgentResult> {
    const normalizedInput = inputText.trim();

    if (!normalizedInput) {
      throw new Error("SimpleAgent 输入不能为空");
    }

    const messages: MessageData[] = [
      {
        role: "system",
        content: this.createSystemPrompt(),
      },
      ...this.history.map((message) => message.toDict()),
      {
        role: "user",
        content: normalizedInput,
      },
    ];

    if (!this.enableToolCalling) {
      return this.runWithoutTools(messages, normalizedInput);
    }

    return this.runWithTools(messages, normalizedInput);
  }

  public addTool<TInput>(
    tool: import("../../tools/tool.js").Tool<TInput>,
  ): void {
    if (!this.toolRegistry) {
      throw new Error("当前 SimpleAgent 没有 ToolRegistry，请在构造时传入。");
    }

    this.toolRegistry.register(tool);
  }

  public removeTool(name: string): boolean {
    return this.toolRegistry?.unregister(name) ?? false;
  }

  public hasTools(): boolean {
    return (this.toolRegistry?.size ?? 0) > 0;
  }

  public listTools(): string[] {
    return this.toolRegistry?.listNames() ?? [];
  }
}
