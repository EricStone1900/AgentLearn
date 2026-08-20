import "dotenv/config";
import { FunctionCallAgent } from "../agents/function-call/function-call-agent.js";
import { HelloAgentsLlm } from "../core/hello-agents-llm.js";
import {
  createProductionMemoryManager,
  loadProductionMemoryConfig,
} from "../memory/index.js";
import { createDefaultToolRegistry } from "../tools/create-default-registry.js";

async function main(): Promise<void> {
  const runtime = await createProductionMemoryManager({
    userId: "user-123",
    infrastructure: loadProductionMemoryConfig(),
  });

  try {
    const tools = createDefaultToolRegistry({
      includeSearch: false,
      memoryManager: runtime.manager,
    });
    const agent = new FunctionCallAgent({
      name: "持久化记忆助手",
      llm: new HelloAgentsLlm(),
      toolRegistry: tools,
      enableToolCalling: true,
      maxToolIterations: 6,
      systemPrompt: [
        "你是一个具有持久化记忆能力的助手。",
        "用户明确要求记住信息时调用 memory add。",
        "回答用户偏好或历史问题前调用 memory search。",
        "不要保存密码、令牌、身份证号等敏感数据。",
      ].join(""),
    });

    console.log((await agent.run("请记住我正在学习 Neo4j")).answer);
    console.log((await agent.run("我正在学习什么？")).answer);
  } finally {
    await runtime.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});