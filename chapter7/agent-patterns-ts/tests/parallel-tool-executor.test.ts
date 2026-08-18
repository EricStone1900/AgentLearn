import { describe, expect, it } from "vitest";

import { advancedCalculatorTool } from "../src/tools/advanced-calculator.js";

import { ParallelToolExecutor } from "../src/tools/parallel-tool-executor.js";

import { ToolRegistry } from "../src/tools/tool.js";

describe("ParallelToolExecutor", () => {
  it("能够并行执行多个工具任务", async () => {
    const registry = new ToolRegistry();

    registry.register(advancedCalculatorTool);

    const executor = new ParallelToolExecutor(registry, 2);

    const results = await executor.executeAll([
      {
        id: "sqrt",
        toolName: "advanced_calculator",
        input: {
          operation: "sqrt",
          value: 16,
        },
      },
      {
        id: "multiply",
        toolName: "advanced_calculator",
        input: {
          operation: "binary",
          left: 5,
          operator: "*",
          right: 6,
        },
      },
    ]);

    expect(results[0]?.result.output).toBe("4");
    expect(results[1]?.result.output).toBe("30");
  });
});
