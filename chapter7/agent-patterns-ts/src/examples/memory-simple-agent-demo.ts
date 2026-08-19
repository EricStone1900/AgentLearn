import "dotenv/config";
import { SimpleAgent } from "../agents/simple/simple-agent.js";
import { HelloAgentsLlm } from "../core/hello-agents-llm.js";
import { createInMemoryMemoryManager } from "../memory/index.js";
import { createDefaultToolRegistry } from "../tools/create-default-registry.js";

async function main(): Promise<void> {
  const manager = createInMemoryMemoryManager({ userId: "user-123" });
  const tools = createDefaultToolRegistry({
    includeSearch: false,
    memoryManager: manager,
  });
  const agent = new SimpleAgent({
    name: "文本协议记忆助手",
    llm: new HelloAgentsLlm(),
    toolRegistry: tools,
    enableToolCalling: true,
    maxToolIterations: 6,
    systemPrompt: [
      "你是一个具有记忆能力的助手。",
      "用户要求记住信息时调用 memory add。",
      "回答历史和偏好问题前调用 memory search。",
    ].join(""),
  });

  console.log((await agent.run("请记住我喜欢使用 Node.js")).answer);
  console.log((await agent.run("我喜欢使用什么运行环境？")).answer);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});