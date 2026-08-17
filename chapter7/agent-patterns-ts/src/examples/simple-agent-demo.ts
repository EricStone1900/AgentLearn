import { HelloAgentsLlm } from "../core/hello-agents-llm.js";
import { SimpleAgent } from "../agents/simple/simple-agent.js";
import { calculatorTool } from "../tools/calculator.js";
import { ToolRegistry } from "../tools/tool.js";

const llm = new HelloAgentsLlm();

const tools = new ToolRegistry();
tools.register(calculatorTool);

const agent = new SimpleAgent({
  name: "简单工具助手",
  llm,
  toolRegistry: tools,
  systemPrompt: "你是一个回答简洁的数学助手。",
});

const result = await agent.run("请帮我计算 15 乘以 8。");

console.log(result.answer);
