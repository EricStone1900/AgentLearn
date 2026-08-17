import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

import type {
  HelloAgentsLlmOptions,
  InvocationOptions,
  LlmProvider,
  ResolvedLlmConfig,
} from "./llm-types.js";
import type { MessageData } from "./types.js";
import { resolveLlmConfig } from "./llm-provider.js";
import { LlmInvocationError } from "./errors.js";
import type {
  NativeToolCallingLlmClient,
  NativeToolCompletionRequest,
} from "./native-tool-calling.js";

export class HelloAgentsLlm implements NativeToolCallingLlmClient {
  private readonly client: OpenAI;
  private readonly config: ResolvedLlmConfig;

  public constructor(options: HelloAgentsLlmOptions = {}) {
    this.config = resolveLlmConfig(options);

    this.client = new OpenAI({
      apiKey: this.config.apiKey,
      baseURL: this.config.baseURL,
      timeout: this.config.timeoutMs,
    });
  }

  public get provider(): LlmProvider {
    return this.config.provider;
  }

  public get model(): string {
    return this.config.model;
  }

  public getInfo(): Omit<ResolvedLlmConfig, "apiKey"> {
    const { apiKey: _apiKey, ...safeConfig } = this.config;

    return safeConfig;
  }

  private toSdkMessages(messages: MessageData[]): ChatCompletionMessageParam[] {
    if (messages.length === 0) {
      throw new LlmInvocationError("调用 LLM 时消息列表不能为空");
    }

    return messages.map((message) => {
      switch (message.role) {
        case "system":
          return {
            role: "system",
            content: message.content,
          };

        case "user":
          return {
            role: "user",
            content: message.content,
          };

        case "assistant":
          return {
            role: "assistant",
            content: message.content,
          };
        case "tool":
          throw new LlmInvocationError(
            [
              "当前 LLM 接口尚未支持直接发送 tool 消息。",
              "请在实现 FunctionCallAgent 时补充 tool_call_id。",
            ].join(""),
          );
      }
    });
  }

  public async invoke(
    messages: MessageData[],
    options: InvocationOptions = {},
  ): Promise<string> {
    const sdkMessages = this.toSdkMessages(messages);

    const temperature = options.temperature ?? this.config.temperature;

    const maxTokens = options.maxTokens ?? this.config.maxTokens;

    try {
      const response = await this.client.chat.completions.create({
        model: this.config.model,
        messages: sdkMessages,
        temperature,
        stream: false,

        ...(maxTokens === undefined
          ? {}
          : {
              max_tokens: maxTokens,
            }),
      });

      const content = response.choices[0]?.message.content?.trim();

      if (!content) {
        throw new Error("模型返回了空文本");
      }

      return content;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);

      throw new LlmInvocationError(`LLM 调用失败：${message}`, {
        cause: error,
      });
    }
  }

  public async generate(
    messages: MessageData[],
    temperature?: number,
  ): Promise<string> {
    return this.invoke(messages, {
      ...(temperature === undefined ? {} : { temperature }),
    });
  }

  public async *streamInvoke(
    messages: MessageData[],
    options: InvocationOptions = {},
  ): AsyncGenerator<string> {
    const sdkMessages = this.toSdkMessages(messages);

    const temperature = options.temperature ?? this.config.temperature;

    const maxTokens = options.maxTokens ?? this.config.maxTokens;

    try {
      const stream = await this.client.chat.completions.create({
        model: this.config.model,
        messages: sdkMessages,
        temperature,
        stream: true,

        ...(maxTokens === undefined
          ? {}
          : {
              max_tokens: maxTokens,
            }),
      });

      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content ?? "";

        if (content) {
          yield content;
        }
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);

      throw new LlmInvocationError(`LLM 流式调用失败：${message}`, {
        cause: error,
      });
    }
  }

  public async *think(
    messages: MessageData[],
    temperature?: number,
  ): AsyncGenerator<string> {
    console.log(`🧠 正在调用 ${this.config.model} 模型...`);

    try {
      let receivedContent = false;

      for await (const chunk of this.streamInvoke(messages, {
        ...(temperature === undefined ? {} : { temperature }),
      })) {
        receivedContent = true;
        process.stdout.write(chunk);
        yield chunk;
      }

      process.stdout.write("\n");

      if (!receivedContent) {
        throw new Error("模型返回了空文本");
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);

      console.error(`❌ 调用 LLM API 时发生错误：${message}`);

      if (error instanceof LlmInvocationError) {
        throw error;
      }

      throw new LlmInvocationError(`LLM 调用失败：${message}`, {
        cause: error,
      });
    }
  }

  public async createToolCompletion(
    request: NativeToolCompletionRequest,
  ): Promise<import("openai/resources/chat/completions").ChatCompletion> {
    if (request.messages.length === 0) {
      throw new LlmInvocationError("工具调用消息列表不能为空");
    }

    if (request.tools.length === 0) {
      throw new LlmInvocationError("工具调用定义不能为空");
    }

    const temperature = request.temperature ?? this.config.temperature;

    const maxTokens = this.config.maxTokens;

    try {
      return await this.client.chat.completions.create({
        model: this.config.model,
        messages: request.messages,
        tools: request.tools,
        tool_choice: request.toolChoice ?? "auto",
        temperature,
        stream: false,

        ...(maxTokens === undefined
          ? {}
          : {
              max_tokens: maxTokens,
            }),
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);

      throw new LlmInvocationError(`LLM 原生工具调用失败：${message}`, {
        cause: error,
      });
    }
  }
}
