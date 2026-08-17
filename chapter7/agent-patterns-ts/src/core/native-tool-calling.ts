import type {
  ChatCompletion,
  ChatCompletionMessageParam,
  ChatCompletionTool,
  ChatCompletionToolChoiceOption,
} from "openai/resources/chat/completions";

import type { LlmClient } from "./types.js";

export interface NativeToolCompletionRequest {
  messages: ChatCompletionMessageParam[];
  tools: ChatCompletionTool[];
  toolChoice?: ChatCompletionToolChoiceOption;
  temperature?: number;
}

export interface NativeToolCallingLlmClient extends LlmClient {
  createToolCompletion(
    request: NativeToolCompletionRequest,
  ): Promise<ChatCompletion>;
}
