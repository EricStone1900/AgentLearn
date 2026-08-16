import OpenAI from "openai";
import type { AppConfig } from "./config.js";
import type { LlmClient, Message } from "./types.js";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

export class OpenAiLlmClient implements LlmClient {
  private readonly client: OpenAI;

  public constructor(private readonly config: AppConfig) {
    this.client = new OpenAI({
      apiKey: config.LLM_API_KEY,
      baseURL: config.LLM_BASE_URL,
      timeout: config.LLM_TIMEOUT_MS,
    });
  }

  public async generate(messages: Message[], temperature = 0): Promise<string> {
    const sdkMessages: ChatCompletionMessageParam[] = messages.map(
      (message) => {
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
        }
      },
    );
    console.log(`🧠 正在调用 ${this.config.LLM_MODEL_ID} 模型...`);
    try {
      const stream = await this.client.chat.completions.create({
        model: this.config.LLM_MODEL_ID,
        messages: sdkMessages,
        temperature,
        stream: true,
      });

      console.log("✅ 大语言模型响应成功:");

      const collectedContent: string[] = [];

      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content ?? "";

        if (!content) {
          continue;
        }

        process.stdout.write(content);
        collectedContent.push(content);
      }

      process.stdout.write("\n");

      const fullText = collectedContent.join("");

      if (!fullText.trim()) {
        throw new Error("模型返回了空文本");
      }

      return fullText;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);

      console.error(`❌ 调用 LLM API 时发生错误: ${message}`);

      // 继续向上抛出，让命令行入口或 Agent 决定如何处理。
      throw error;
    }
  }
}
