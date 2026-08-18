import { describe, expect, it } from "vitest";

import { advancedCalculatorTool } from "../src/tools/advanced-calculator.js";

import { ToolChain } from "../src/tools/tool-chain.js";

import { ToolRegistry } from "../src/tools/tool.js";

describe("ToolChain", () => {
  it("能够把前一步结果传给后一步", async () => {
    const registry = new ToolRegistry();

    registry.register(advancedCalculatorTool);

    const chain = new ToolChain("calculation", "两步计算");

    chain.addStep({
      toolName: "advanced_calculator",
      outputKey: "sum",

      buildInput() {
        return {
          operation: "binary",
          left: 2,
          operator: "+",
          right: 3,
        };
      },
    });

    chain.addStep({
      toolName: "advanced_calculator",
      outputKey: "result",

      buildInput(context) {
        return {
          operation: "binary",
          left: Number(context.sum),
          operator: "*",
          right: 10,
        };
      },
    });

    const result = await chain.execute(registry, null);

    expect(result).toBe("50");
  });
});
