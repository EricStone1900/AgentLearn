import type {
  ChatCompletionMessageFunctionToolCall,
  ChatCompletionMessageParam,
  ChatCompletionToolChoiceOption,
} from "openai/resources/chat/completions";

import { Agent, type AgentOptions } from "../../core/agent.js";
import { Message } from "../../core/message.js";
import type { NativeToolCallingLlmClient } from "../../core/native-tool-calling.js";
import type { AgentResult, MessageData } from "../../core/types.js";
import type { ToolRegistry } from "../../tools/tool.js";

export interface FunctionCallAgentOptions extends Omit<AgentOptions, "llm"> {
  llm: NativeToolCallingLlmClient;
  toolRegistry?: ToolRegistry;
  enableToolCalling?: boolean;
  defaultToolChoice?: ChatCompletionToolChoiceOption;
  maxToolIterations?: number;
}

export class FunctionCallAgent extends Agent {
  private readonly nativeLlm: NativeToolCallingLlmClient;
  private readonly toolRegistry: ToolRegistry | undefined;
  private readonly enableToolCalling: boolean;
  private readonly defaultToolChoice: ChatCompletionToolChoiceOption;
  private readonly maxToolIterations: number;

  public constructor(options: FunctionCallAgentOptions) {
    super(options);

    this.nativeLlm = options.llm;
    this.toolRegistry = options.toolRegistry;

    this.enableToolCalling =
      (options.enableToolCalling ?? true) && options.toolRegistry !== undefined;

    this.defaultToolChoice = options.defaultToolChoice ?? "auto";

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
      this.systemPrompt ?? "你是一个可靠的 AI 助手，可以在需要时调用工具。";

    if (!this.enableToolCalling || !this.toolRegistry) {
      return basePrompt;
    }

    return [
      basePrompt,
      "",
      "## 可用工具",
      this.toolRegistry.describe(),
      "",
      "请自行判断是否需要调用工具。",
      "不要编造工具执行结果。",
      "如果需要多个工具，可以分多轮调用。",
      "获得足够信息后，请直接回答用户。",
    ].join("\n");
  }

  private buildSdkMessages(inputText: string): ChatCompletionMessageParam[] {
    const messages: ChatCompletionMessageParam[] = [
      {
        role: "system",
        content: this.createSystemPrompt(),
      },
    ];

    for (const message of this.history) {
      switch (message.role) {
        case "system":
          messages.push({
            role: "system",
            content: message.content,
          });
          break;

        case "user":
          messages.push({
            role: "user",
            content: message.content,
          });
          break;

        case "assistant":
          messages.push({
            role: "assistant",
            content: message.content,
          });
          break;

        case "tool":
          /*
           * 持久化历史中的普通 Message 没有 tool_call_id，
           * 因此不允许直接恢复为 SDK tool 消息。
           */
          throw new Error("历史记录中的 tool 消息缺少 tool_call_id");
      }
    }

    messages.push({
      role: "user",
      content: inputText,
    });

    return messages;
  }
  private parseArguments(argumentsText: string): unknown {
    try {
      return JSON.parse(argumentsText);
    } catch {
      return undefined;
    }
  }

  private getFunctionCalls(
    toolCalls:
      | import("openai/resources/chat/completions").ChatCompletionMessageToolCall[]
      | undefined,
  ): ChatCompletionMessageFunctionToolCall[] {
    return (toolCalls ?? []).filter(
      (call): call is ChatCompletionMessageFunctionToolCall =>
        call.type === "function",
    );
  }

  private async runWithoutNativeTools(inputText: string): Promise<AgentResult> {
    const messages: MessageData[] = [
      {
        role: "system",
        content: this.createSystemPrompt(),
      },
      ...this.history.map((message) => message.toDict()),
      {
        role: "user",
        content: inputText,
      },
    ];

    const answer = await this.llm.generate(messages, this.config.temperature);

    this.addMessage(new Message(inputText, "user"));
    this.addMessage(new Message(answer, "assistant"));

    return {
      answer,
      steps: 1,
    };
  }

  public async run(inputText: string): Promise<AgentResult> {
    const normalizedInput = inputText.trim();

    if (!normalizedInput) {
      throw new Error("FunctionCallAgent 输入不能为空");
    }

    const tools =
      this.enableToolCalling && this.toolRegistry
        ? this.toolRegistry.toOpenAiTools()
        : [];

    if (tools.length === 0 || !this.toolRegistry) {
      return this.runWithoutNativeTools(normalizedInput);
    }

    const messages = this.buildSdkMessages(normalizedInput);

    let llmCalls = 0;

    for (
      let iteration = 0;
      iteration < this.maxToolIterations;
      iteration += 1
    ) {
      const completion = await this.nativeLlm.createToolCompletion({
        messages,
        tools,
        toolChoice: this.defaultToolChoice,
        temperature: this.config.temperature,
      });

      llmCalls += 1;

      const assistantMessage = completion.choices[0]?.message;

      if (!assistantMessage) {
        throw new Error("模型没有返回 assistant 消息");
      }

      const functionCalls = this.getFunctionCalls(assistantMessage.tool_calls);

      /*
       * 没有工具调用，说明模型已经给出最终答案。
       */
      if (functionCalls.length === 0) {
        const answer = assistantMessage.content?.trim();

        if (!answer) {
          throw new Error("模型返回了空的最终答案");
        }

        this.addMessage(new Message(normalizedInput, "user"));
        this.addMessage(new Message(answer, "assistant"));

        return {
          answer,
          steps: llmCalls,
        };
      }

      /*
       * 必须先把带 tool_calls 的 assistant 消息
       * 放回消息列表。
       */
      messages.push({
        role: "assistant",
        content: assistantMessage.content,
        tool_calls: functionCalls.map((call) => ({
          id: call.id,
          type: "function",
          function: {
            name: call.function.name,
            arguments: call.function.arguments,
          },
        })),
      });

      /*
       * 执行每一个工具调用，并通过 tool_call_id
       * 将结果和对应调用关联起来。
       */
      for (const call of functionCalls) {
        const input = this.parseArguments(call.function.arguments);

        const result =
          input === undefined
            ? `错误：工具 "${call.function.name}" 的参数不是合法 JSON`
            : await this.toolRegistry.execute(call.function.name, input);

        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: result,
        });
      }
    }

    /*
     * 达到最大工具调用次数后，禁用继续调用，
     * 要求模型根据已有结果生成最终回答。
     */
    const finalCompletion = await this.nativeLlm.createToolCompletion({
      messages,
      tools,
      toolChoice: "none",
      temperature: this.config.temperature,
    });

    llmCalls += 1;

    const finalAnswer = finalCompletion.choices[0]?.message.content?.trim();

    if (!finalAnswer) {
      throw new Error("达到最大工具调用次数后，模型仍未返回最终答案");
    }

    this.addMessage(new Message(normalizedInput, "user"));
    this.addMessage(new Message(finalAnswer, "assistant"));

    return {
      answer: finalAnswer,
      steps: llmCalls,
    };
  }
}
