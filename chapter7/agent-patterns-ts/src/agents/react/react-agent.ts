import { z } from "zod";
import { parseJson } from "../../core/json.js";
// import type { AgentResult, LlmClient } from "../../core/types.js";
import { Agent, type AgentOptions } from "../../core/agent.js";
import { Message } from "../../core/message.js";
import type { AgentResult } from "../../core/types.js";
import type { ToolRegistry } from "../../tools/tool.js";

export const reactDecisionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("tool"),
    thought: z.string().min(1),
    tool: z.string().min(1),
    input: z.unknown(),
  }),

  z.object({
    type: z.literal("finish"),
    thought: z.string().min(1),
    answer: z.string().min(1),
  }),
]);

function createReActSystemPrompt(toolDescriptions: string): string {
  return `
你是一个能够使用外部工具解决问题的智能助手。

你的工作流程是：
1. 分析当前问题和已有 Observation。
2. 决定调用一个工具，或者结束任务。
3. 如果工具返回错误，根据错误信息修正下一步行动。
4. 收集到足够信息后返回最终答案。

可用工具：
${toolDescriptions}

每一轮必须且只能输出一个 JSON 对象。
不要输出 Markdown 代码围栏。
不要在 JSON 前后添加解释文字。

调用工具时使用以下格式：
{
  "type": "tool",
  "thought": "简短说明为什么需要这个工具",
  "tool": "工具名称",
  "input": {}
}

完成任务时使用以下格式：
{
  "type": "finish",
  "thought": "简短说明为什么信息已经足够",
  "answer": "给用户的最终答案"
}

规则：
- 只能调用“可用工具”列表中存在的工具。
- 工具输入必须符合工具描述中的参数格式。
- 一轮只能调用一个工具。
- 不要自行编造工具返回结果。
- 如果 Observation 包含错误，请修正工具名或参数。
- 如果问题需要多步计算，必须使用上一步 Observation 作为下一步输入。
- 信息不足时不要过早输出 finish。
`.trim();
}

export interface ReActAgentOptions extends AgentOptions {
  tools: ToolRegistry;
  maxSteps?: number;
}

export class ReActAgent extends Agent {
  private readonly tools: ToolRegistry;
  private readonly maxSteps: number;

  public constructor(options: ReActAgentOptions) {
    super(options);

    this.tools = options.tools;
    this.maxSteps = options.maxSteps ?? 5;

    if (!Number.isInteger(this.maxSteps) || this.maxSteps <= 0) {
      throw new Error("ReActAgent 的 maxSteps 必须是正整数");
    }
  }

  public async run(question: string): Promise<AgentResult> {
    if (!Number.isInteger(this.maxSteps) || this.maxSteps <= 0) {
      throw new Error("ReActAgent 的 maxSteps 必须是正整数");
    }

    const history: string[] = [];

    // const systemPrompt = createReActSystemPrompt(this.tools.describe());
    const systemPrompt = [
      this.systemPrompt,
      createReActSystemPrompt(this.tools.describeWithSchemas()),
    ]
      .filter((content): content is string => Boolean(content))
      .join("\n\n");

    for (let currentStep = 1; currentStep <= this.maxSteps; currentStep += 1) {
      console.log(`\n--- ReAct 第 ${currentStep}/${this.maxSteps} 步 ---`);

      const historyText =
        history.length > 0 ? history.join("\n\n") : "暂无历史记录";

      const rawResponse = await this.llm.generate(
        [
          {
            role: "system",
            content: systemPrompt,
          },
          {
            role: "user",
            content: [
              `用户问题：${question}`,
              "",
              "此前的行动与观察：",
              historyText,
              "",
              "请根据当前信息决定下一步行动。",
            ].join("\n"),
          },
        ],
        0,
      );

      let decision: z.infer<typeof reactDecisionSchema>;

      try {
        decision = parseJson(rawResponse, reactDecisionSchema);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);

        const formatObservation = [
          `模型原始输出：${rawResponse}`,
          "Observation: 上一轮输出格式不合法。",
          `错误详情：${message}`,
          "下一轮必须只返回符合规定格式的 JSON。",
        ].join("\n");

        console.warn(formatObservation);

        history.push(formatObservation);
        continue;
      }

      console.log(`🤔 Thought: ${decision.thought}`);

      if (decision.type === "finish") {
        console.log("🎉 Agent 已完成任务");
        this.addMessage(new Message(question, "user"));
        this.addMessage(new Message(decision.answer, "assistant"));
        return {
          answer: decision.answer,
          steps: currentStep,
        };
      }

      console.log(
        `🛠️ Action: ${decision.tool} ${JSON.stringify(decision.input)}`,
      );

      const observation = await this.tools.execute(
        decision.tool,
        decision.input,
      );

      console.log(`👀 Observation: ${observation}`);

      history.push(
        [
          `Thought: ${decision.thought}`,
          `Action: ${decision.tool} ${JSON.stringify(decision.input)}`,
          `Observation: ${observation}`,
        ].join("\n"),
      );
    }

    throw new Error(
      [
        `ReAct 达到最大步骤数 ${this.maxSteps}，但任务仍未完成。`,
        "完整轨迹：",
        history.join("\n\n"),
      ].join("\n"),
    );
  }
}
