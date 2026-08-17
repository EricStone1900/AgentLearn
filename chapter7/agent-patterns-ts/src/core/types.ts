import type { MessageData } from "./message.js";

export { Message } from "./message.js";

export type {
  MessageData,
  MessageMetadata,
  MessageOptions,
  MessageRole,
} from "./message.js";

/**
 * 所有 Agent 只依赖这个接口，
 * 不直接依赖 OpenAI SDK。
 */
export interface LlmClient {
  readonly provider?: string;
  readonly model?: string;

  generate(messages: MessageData[], temperature?: number): Promise<string>;
}

export interface AgentResult {
  answer: string;
  steps: number;
}
