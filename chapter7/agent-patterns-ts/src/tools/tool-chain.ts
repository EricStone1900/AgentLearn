import type { ToolRegistry } from "./tool.js";

export type ToolChainContext = Record<string, unknown>;

export interface ToolChainStep {
  toolName: string;
  outputKey: string;

  buildInput(context: Readonly<ToolChainContext>): unknown;
}

export class ToolChain {
  private readonly steps: ToolChainStep[] = [];

  public constructor(
    public readonly name: string,
    public readonly description: string,
  ) {
    if (!name.trim()) {
      throw new Error("工具链名称不能为空");
    }
  }

  public addStep(step: ToolChainStep): this {
    if (!step.toolName.trim()) {
      throw new Error("工具名称不能为空");
    }

    if (!step.outputKey.trim()) {
      throw new Error("工具链输出键不能为空");
    }

    this.steps.push(step);

    return this;
  }

  public async execute(
    registry: ToolRegistry,
    initialInput: unknown,
    initialContext: ToolChainContext = {},
  ): Promise<string> {
    if (this.steps.length === 0) {
      throw new Error(`工具链 "${this.name}" 没有执行步骤`);
    }

    const context: ToolChainContext = {
      ...initialContext,
      input: initialInput,
    };

    let finalOutput = "";

    for (let index = 0; index < this.steps.length; index += 1) {
      const step = this.steps[index];

      if (!step) {
        throw new Error(`无法读取工具链第 ${index + 1} 步`);
      }

      let toolInput: unknown;

      try {
        toolInput = step.buildInput(context);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);

        throw new Error(`工具链第 ${index + 1} 步构造输入失败：${message}`);
      }

      const result = await registry.executeDetailed(step.toolName, toolInput);

      if (!result.ok) {
        throw new Error(
          [
            `工具链 "${this.name}" 执行失败。`,
            `步骤：${index + 1}`,
            `工具：${step.toolName}`,
            `错误：${result.error}`,
          ].join("\n"),
        );
      }

      context[step.outputKey] = result.output;
      finalOutput = result.output;
    }

    return finalOutput;
  }

  public getSteps(): ToolChainStep[] {
    return [...this.steps];
  }
}

export class ToolChainManager {
  private readonly chains = new Map<string, ToolChain>();

  public constructor(private readonly registry: ToolRegistry) {}

  public register(chain: ToolChain): void {
    if (this.chains.has(chain.name)) {
      throw new Error(`工具链已经存在：${chain.name}`);
    }

    this.chains.set(chain.name, chain);
  }

  public has(name: string): boolean {
    return this.chains.has(name);
  }

  public listNames(): string[] {
    return [...this.chains.keys()];
  }

  public async execute(
    name: string,
    input: unknown,
    context: ToolChainContext = {},
  ): Promise<string> {
    const chain = this.chains.get(name);

    if (!chain) {
      throw new Error(`工具链不存在：${name}`);
    }

    return chain.execute(this.registry, input, context);
  }
}
