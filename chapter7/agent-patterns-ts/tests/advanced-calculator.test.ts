import { describe, expect, it } from "vitest";

import { advancedCalculatorTool } from "../src/tools/advanced-calculator.js";

describe("advancedCalculatorTool", () => {
  it("能够计算平方根", async () => {
    const result = await advancedCalculatorTool.execute({
      operation: "sqrt",
      value: 16,
    });

    expect(result).toBe("4");
  });

  it("能够进行乘法", async () => {
    const result = await advancedCalculatorTool.execute({
      operation: "binary",
      left: 2,
      operator: "*",
      right: 3,
    });

    expect(result).toBe("6");
  });

  it("拒绝除零", async () => {
    await expect(
      advancedCalculatorTool.execute({
        operation: "binary",
        left: 10,
        operator: "/",
        right: 0,
      }),
    ).rejects.toThrow("除数不能为 0");
  });
});
