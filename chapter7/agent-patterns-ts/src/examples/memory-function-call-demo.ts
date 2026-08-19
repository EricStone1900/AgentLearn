import "dotenv/config";
import { FunctionCallAgent } from "../agents/function-call/function-call-agent.js";
import { HelloAgentsLlm } from "../core/hello-agents-llm.js";
import { createInMemoryMemoryManager } from "../memory/index.js";
import { createDefaultToolRegistry } from "../tools/create-default-registry.js";

async function main(): Promise<void> {
  const manager = createInMemoryMemoryManager({ userId: "user-123" });
  const tools = createDefaultToolRegistry({
    includeSearch: false,
    memoryManager: manager,
  });

  // 这一步验证 MemoryTool Schema 可以转换为 OpenAI tools。
  console.log(JSON.stringify(tools.toOpenAiTools(), null, 2));

  const llm = new HelloAgentsLlm();
  const agent = new FunctionCallAgent({
    name: "记忆助手",
    llm,
    toolRegistry: tools,
    enableToolCalling: true,
    maxToolIterations: 6,
    systemPrompt: [
      "你是一个具有记忆能力的助手。",
      "用户明确要求记住信息时，调用 memory 的 add 操作。",
      "问题涉及用户偏好或历史事件时，先调用 search。",
      "不要保存密码、令牌、身份证号等敏感信息。",
      "不要编造工具执行结果。",
    ].join(""),
  });

  console.log((await agent.run("请记住我正在学习 TypeScript")).answer);
  console.log((await agent.run("我现在正在学习什么？")).answer);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});