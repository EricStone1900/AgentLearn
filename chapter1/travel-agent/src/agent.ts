import { generate } from "./llm.js";
import { AGENT_SYSTEM_PROMPT } from "./prompt.js";
import { getAttraction, getWeather } from "./tools.js";

type ToolAction = {
  type: "tool";
  name: "get_weather" | "get_attraction";
  arguments: Record<string, string>;
};

type FinishAction = {
  type: "finish";
  answer: string;
};

type AgentDecision = {
  plan: string;
  action: ToolAction | FinishAction;
};

function parseDecision(text: string): AgentDecision {
  const cleaned = text
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  let value: unknown;

  try {
    value = JSON.parse(cleaned);
  } catch {
    throw new Error(`模型没有返回合法 JSON：${text}`);
  }

  if (!value || typeof value !== "object") {
    throw new Error("模型返回结果不是对象");
  }

  const decision = value as Partial<AgentDecision>;

  if (typeof decision.plan !== "string") {
    throw new Error("模型返回结果缺少 plan");
  }

  if (!decision.action || typeof decision.action !== "object") {
    throw new Error("模型返回结果缺少 action");
  }

  if (
    decision.action.type !== "tool" &&
    decision.action.type !== "finish"
  ) {
    throw new Error("action.type 必须是 tool 或 finish");
  }

  if (decision.action.type === "finish") {
    if (typeof decision.action.answer !== "string") {
      throw new Error("finish 动作缺少 answer");
    }

    return decision as AgentDecision;
  }

  if (
    decision.action.name !== "get_weather" &&
    decision.action.name !== "get_attraction"
  ) {
    throw new Error(`未知工具：${String(decision.action.name)}`);
  }

  if (
    !decision.action.arguments ||
    typeof decision.action.arguments !== "object"
  ) {
    throw new Error("工具动作缺少 arguments");
  }

  return decision as AgentDecision;
}

async function executeTool(action: ToolAction): Promise<string> {
  if (action.name === "get_weather") {
    const city = action.arguments.city;

    if (!city) {
      return "错误：get_weather 缺少 city 参数";
    }

    return getWeather(city);
  }

  if (action.name === "get_attraction") {
    const city = action.arguments.city;
    const weather = action.arguments.weather;

    if (!city) {
      return "错误：get_attraction 缺少 city 参数";
    }

    if (!weather) {
      return "错误：get_attraction 缺少 weather 参数";
    }

    return getAttraction(city, weather);
  }

  return `错误：未定义的工具 ${action.name}`;
}

export async function runAgent(
  userInput: string,
  maxSteps = 5
): Promise<string> {
  const history: string[] = [
    `User Request:\n${userInput}`
  ];

  console.log(`用户输入：${userInput}`);
  console.log("=".repeat(60));

  for (let step = 1; step <= maxSteps; step++) {
    console.log(`\n第 ${step} 轮`);

    const fullPrompt = history.join("\n\n");

    let modelOutput: string;

    try {
      modelOutput = await generate(
        fullPrompt,
        AGENT_SYSTEM_PROMPT
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);

      throw new Error(`调用模型失败：${message}`);
    }

    console.log(`模型输出：\n${modelOutput}`);

    let decision: AgentDecision;

    try {
      decision = parseDecision(modelOutput);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);

      const observation =
        `Observation: 模型输出格式错误：${message}。` +
        `请严格按照系统要求重新输出一个 JSON 对象。`;

      console.log(observation);

      history.push(`Assistant:\n${modelOutput}`);
      history.push(observation);

      continue;
    }

    console.log(`行动计划：${decision.plan}`);

    history.push(
      `Assistant Decision:\n${JSON.stringify(decision)}`
    );

    if (decision.action.type === "finish") {
      console.log("\n任务完成。");

      return decision.action.answer;
    }

    const observation = await executeTool(decision.action);

    console.log(`Observation：${observation}`);

    history.push(
      `Observation:\n${observation}`
    );
  }

  throw new Error(
    `达到最大循环次数 ${maxSteps}，智能体仍未完成任务`
  );
}