import { FunctionCallAgent } from "../agents/function-call/function-call-agent.js";
import { HelloAgentsLlm } from "../core/hello-agents-llm.js";
import { calculatorTool } from "../tools/calculator.js";
import { ToolRegistry } from "../tools/tool.js";

const llm = new HelloAgentsLlm();

const tools = new ToolRegistry();
tools.register(calculatorTool);

const agent = new FunctionCallAgent({
  name: "原生工具调用助手",
  llm,
  toolRegistry: tools,
  systemPrompt: "你是一个严谨的数学助手。",
  maxToolIterations: 3,
});

const result = await agent.run("计算 15 * 8，再告诉我结果。");

console.log(result);
