import { Message } from "./message.js";
import type { MessageData } from "./message.js";
import { Config } from "./config.js";
import type { AgentResult, LlmClient } from "./types.js";

export interface AgentOptions {
  name: string;
  llm: LlmClient;
  systemPrompt?: string;
  config?: Config;
}

export abstract class Agent {
  public readonly name: string;
  public readonly systemPrompt: string | undefined;
  public readonly config: Config;

  protected readonly llm: LlmClient;
  protected readonly history: Message[] = [];

  protected constructor(options: AgentOptions) {
    const normalizedName = options.name.trim();

    if (!normalizedName) {
      throw new Error("Agent 名称不能为空");
    }

    this.name = normalizedName;
    this.llm = options.llm;
    this.systemPrompt = options.systemPrompt;
    this.config = options.config ?? new Config();
  }

  /**
   * 所有具体 Agent 必须实现的统一入口。
   */
  public abstract run(inputText: string): Promise<AgentResult>;

  public addMessage(message: Message): void {
    this.history.push(message);
  }

  public clearHistory(): void {
    this.history.length = 0;
  }

  public getHistory(): Message[] {
    return [...this.history];
  }

  /**
   * 构建发送给 LLM 的基础消息。
   */
  protected buildBaseMessages(): MessageData[] {
    const messages: MessageData[] = [];

    if (this.systemPrompt) {
      messages.push({
        role: "system",
        content: this.systemPrompt,
      });
    }

    messages.push(...this.history.map((message) => message.toDict()));

    return messages;
  }

  public toString(): string {
    const provider = this.llm.provider ?? "unknown";

    return ["Agent(", `name=${this.name}, `, `provider=${provider}`, ")"].join(
      "",
    );
  }
}
