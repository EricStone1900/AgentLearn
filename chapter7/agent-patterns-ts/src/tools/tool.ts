import { z, type ZodType } from "zod";
import type { ChatCompletionTool } from "openai/resources/chat/completions";

export interface Tool<TInput = unknown> {
  name: string;
  description: string;
  inputSchema: ZodType<TInput>;
  execute(input: TInput): Promise<string>;
}

export class ToolRegistry {
  /*
   * 注册表中会同时存放多种工具。
   *
   * 例如：
   * Tool<CalculatorInput>
   * Tool<SearchInput>
   *
   * 它们的输入类型各不相同，因此在注册表内部做统一存储。
   * 真正执行前仍会通过每个工具自己的 Zod Schema 进行校验。
   */
  private readonly tools = new Map<string, Tool<any>>();

  public register<TInput>(tool: Tool<TInput>): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`工具已经存在：${tool.name}`);
    }

    this.tools.set(tool.name, tool);
  }

  public describe(): string {
    if (this.tools.size === 0) {
      return "当前没有可用工具";
    }

    return [...this.tools.values()]
      .map((tool) => `- ${tool.name}: ${tool.description}`)
      .join("\n");
  }

  public async execute(name: string, input: unknown): Promise<string> {
    const tool = this.tools.get(name);

    if (!tool) {
      return `错误：不存在名为 "${name}" 的工具`;
    }

    const parsed = tool.inputSchema.safeParse(input);

    if (!parsed.success) {
      return [
        `错误：工具 "${name}" 的参数不合法。`,
        z.prettifyError(parsed.error),
      ].join("\n");
    }

    try {
      return await tool.execute(parsed.data);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);

      return `错误：工具 "${name}" 执行失败：${message}`;
    }
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

  public listNames(): string[] {
    return [...this.tools.keys()];
  }

  public toOpenAiTools(): ChatCompletionTool[] {
    return [...this.tools.values()].map((tool) => {
      const jsonSchema = z.toJSONSchema(tool.inputSchema);

      /*
       * OpenAI 只需要参数 Schema，
       * 不需要 Zod 生成的顶层 $schema 字段。
       */
      const { $schema: _schema, ...parameters } = jsonSchema;

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
