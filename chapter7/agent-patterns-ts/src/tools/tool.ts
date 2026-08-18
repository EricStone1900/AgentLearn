import { z, type ZodType } from "zod";
import type { ChatCompletionTool } from "openai/resources/chat/completions";

export interface Tool<TInput = unknown> {
  name: string;
  description: string;
  inputSchema: ZodType<TInput>;
  execute(input: TInput): Promise<string>;
}

export type ToolExecutionResult =
  | {
      ok: true;
      output: string;
    }
  | {
      ok: false;
      output: string;
      error: string;
    };

export interface FunctionToolOptions<TInput> {
  name: string;
  description: string;
  inputSchema: ZodType<TInput>;
  handler(input: TInput): Promise<string> | string;
}

interface RegisteredTool {
  name: string;
  description: string;
  inputSchema: ZodType;

  run(input: unknown): Promise<ToolExecutionResult>;
}

export class ToolRegistry {
  private readonly tools = new Map<string, RegisteredTool>();

  public register<TInput>(tool: Tool<TInput>): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`工具已经存在：${tool.name}`);
    }

    const registeredTool: RegisteredTool = {
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,

      async run(input: unknown): Promise<ToolExecutionResult> {
        const parsed = tool.inputSchema.safeParse(input);

        if (!parsed.success) {
          const error = z.prettifyError(parsed.error);

          return {
            ok: false,
            error,
            output: [`错误：工具 "${tool.name}" 的参数不合法。`, error].join(
              "\n",
            ),
          };
        }

        try {
          const output = await tool.execute(parsed.data);

          return {
            ok: true,
            output,
          };
        } catch (error: unknown) {
          const message =
            error instanceof Error ? error.message : String(error);

          return {
            ok: false,
            error: message,
            output: `错误：工具 "${tool.name}" 执行失败：${message}`,
          };
        }
      },
    };

    this.tools.set(tool.name, registeredTool);
  }

  public registerFunction<TInput>(options: FunctionToolOptions<TInput>): void {
    const tool: Tool<TInput> = {
      name: options.name,
      description: options.description,
      inputSchema: options.inputSchema,

      async execute(input) {
        return options.handler(input);
      },
    };

    this.register(tool);
  }

  public async executeDetailed(
    name: string,
    input: unknown,
  ): Promise<ToolExecutionResult> {
    const tool = this.tools.get(name);

    if (!tool) {
      const error = `不存在名为 "${name}" 的工具`;

      return {
        ok: false,
        error,
        output: `错误：${error}`,
      };
    }

    return tool.run(input);
  }
  public async execute(name: string, input: unknown): Promise<string> {
    const result = await this.executeDetailed(name, input);

    return result.output;
  }

  public get size(): number {
    return this.tools.size;
  }

  public has(name: string): boolean {
    return this.tools.has(name);
  }

  public unregister(name: string): boolean {
    return this.tools.delete(name);
  }

  public clear(): void {
    this.tools.clear();
  }

  public listNames(): string[] {
    return [...this.tools.keys()];
  }

  public describe(): string {
    if (this.tools.size === 0) {
      return "当前没有可用工具";
    }

    return [...this.tools.values()]
      .map((tool) => {
        return `- ${tool.name}: ${tool.description}`;
      })
      .join("\n");
  }

  public describeWithSchemas(): string {
    if (this.tools.size === 0) {
      return "当前没有可用工具";
    }

    return [...this.tools.values()]
      .map((tool) => {
        const schema = z.toJSONSchema(tool.inputSchema);
        const { $schema: _schema, ...parameters } = schema;

        return [
          `- ${tool.name}: ${tool.description}`,
          `  参数：${JSON.stringify(parameters)}`,
        ].join("\n");
      })
      .join("\n");
  }

  public toOpenAiTools(): ChatCompletionTool[] {
    return [...this.tools.values()].map((tool) => {
      const jsonSchema = z.toJSONSchema(tool.inputSchema);

      const { $schema: _schema, ...parameters } = jsonSchema;

      /*
       * Function Calling 要求 parameters
       * 顶层必须是 JSON object。
       */
      if (parameters.type !== "object") {
        throw new Error(
          [
            `工具 "${tool.name}" 无法转换为 Function Calling Schema。`,
            "工具 inputSchema 顶层必须使用 z.object()。",
            `当前顶层类型：${String(parameters.type ?? "undefined")}`,
          ].join("\n"),
        );
      }

      return {
        type: "function",
        function: {
          name: tool.name,
          description: tool.description,
          parameters,
        },
      };
    });
  }
}
