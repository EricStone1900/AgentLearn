export type MessageRole = "system" | "user" | "assistant";

export interface Message {
  role: MessageRole;
  content: string;
}

/** 三种 Agent 只依赖此接口，不直接依赖具体 SDK。 */
export interface LlmClient {
  generate(messages: Message[], temperature?: number): Promise<string>;
}

export interface AgentResult {
  answer: string;
  steps: number;
}
