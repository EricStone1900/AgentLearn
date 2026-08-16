import type { LlmClient, Message } from "../../src/core/types.js";

export class FakeLlmClient implements LlmClient {
  public readonly calls: Message[][] = [];

  public constructor(private readonly replies: string[]) {}

  public async generate(
    messages: Message[],
    _temperature = 0,
  ): Promise<string> {
    this.calls.push(messages.map((message) => ({ ...message })));

    const reply = this.replies.shift();

    if (reply === undefined) {
      throw new Error("FakeLlmClient 响应已耗尽");
    }

    return reply;
  }
}
