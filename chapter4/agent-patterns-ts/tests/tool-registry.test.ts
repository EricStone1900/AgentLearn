import { describe, expect, it } from "vitest";
import { calculatorTool } from "../src/tools/calculator.js";
import { ToolRegistry } from "../src/tools/tool.js";

describe("ToolRegistry", () => {
  it("可以注册并执行计算器工具", async () => {
    const registry = new ToolRegistry();

    registry.register(calculatorTool);

    const result = await registry.execute("calculator", {
      left: 123,
      operator: "+",
      right: 456,
    });

    expect(result).toBe("579");
  });

  it("非法参数会转换成错误 Observation", async () => {
    const registry = new ToolRegistry();

    registry.register(calculatorTool);

    const result = await registry.execute("calculator", {
      left: 10,
      operator: "%",
      right: 2,
    });

    expect(result).toContain("参数不合法");
  });

  it("未知工具会返回错误 Observation", async () => {
    const registry = new ToolRegistry();

    const result = await registry.execute("unknown-tool", {});

    expect(result).toContain("不存在");
  });

  it("除数为零会返回执行错误", async () => {
    const registry = new ToolRegistry();

    registry.register(calculatorTool);

    const result = await registry.execute("calculator", {
      left: 10,
      operator: "/",
      right: 0,
    });

    expect(result).toContain("除数不能为 0");
  });

  it("不允许重复注册同名工具", () => {
    const registry = new ToolRegistry();

    registry.register(calculatorTool);

    expect(() => {
      registry.register(calculatorTool);
    }).toThrow("工具已经存在");
  });
});
