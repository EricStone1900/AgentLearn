import type { ToolExecutionResult, ToolRegistry } from "./tool.js";

export interface ToolTask {
  id: string;
  toolName: string;
  input: unknown;
}

export interface ToolTaskResult {
  id: string;
  toolName: string;
  result: ToolExecutionResult;
}

export class ParallelToolExecutor {
  public constructor(
    private readonly registry: ToolRegistry,
    private readonly concurrency = 4,
  ) {
    if (!Number.isInteger(concurrency) || concurrency < 1) {
      throw new Error("concurrency 必须是正整数");
    }
  }

  public async executeAll(tasks: ToolTask[]): Promise<ToolTaskResult[]> {
    const results = new Array<ToolTaskResult>(tasks.length);

    let nextTaskIndex = 0;

    const worker = async (): Promise<void> => {
      while (true) {
        const currentIndex = nextTaskIndex;

        nextTaskIndex += 1;

        const task = tasks[currentIndex];

        if (!task) {
          return;
        }

        const result = await this.registry.executeDetailed(
          task.toolName,
          task.input,
        );

        results[currentIndex] = {
          id: task.id,
          toolName: task.toolName,
          result,
        };
      }
    };

    const workerCount = Math.min(this.concurrency, tasks.length);

    await Promise.all(Array.from({ length: workerCount }, () => worker()));

    return results;
  }
}
