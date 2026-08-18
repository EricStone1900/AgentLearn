import { z } from "zod";

import type { Tool } from "./tool.js";

/*
 * Function Calling 要求 parameters 顶层必须是 object。
 *
 * 因此这里不能直接使用顶层：
 *
 * z.discriminatedUnion(...)
 *
 * 而是使用一个统一的 z.object()，
 * 再通过 superRefine 检查不同 operation 所需的参数。
 */
const advancedCalculatorInputSchema = z
  .object({
    operation: z
      .enum(["binary", "sqrt", "abs", "round"])
      .describe(
        [
          "需要执行的运算类型。",
          "binary 表示二元运算；",
          "sqrt 表示平方根；",
          "abs 表示绝对值；",
          "round 表示四舍五入。",
        ].join(""),
      ),

    left: z.number().optional().describe("binary 运算必填，表示左操作数"),

    operator: z
      .enum(["+", "-", "*", "/", "^"])
      .optional()
      .describe("binary 运算必填，表示二元运算符"),

    right: z.number().optional().describe("binary 运算必填，表示右操作数"),

    value: z
      .number()
      .optional()
      .describe("sqrt、abs、round 运算必填，表示参与运算的数字"),

    digits: z
      .number()
      .int()
      .min(0)
      .max(10)
      .optional()
      .describe("round 运算可选，表示保留的小数位数，默认为 0"),
  })
  .superRefine((input, context) => {
    /*
     * binary 必须提供：
     * left、operator、right
     */
    if (input.operation === "binary") {
      if (input.left === undefined) {
        context.addIssue({
          code: "custom",
          path: ["left"],
          message: "binary 运算必须提供 left",
        });
      }

      if (input.operator === undefined) {
        context.addIssue({
          code: "custom",
          path: ["operator"],
          message: "binary 运算必须提供 operator",
        });
      }

      if (input.right === undefined) {
        context.addIssue({
          code: "custom",
          path: ["right"],
          message: "binary 运算必须提供 right",
        });
      }
    }

    /*
     * sqrt、abs、round 必须提供 value。
     */
    if (
      input.operation === "sqrt" ||
      input.operation === "abs" ||
      input.operation === "round"
    ) {
      if (input.value === undefined) {
        context.addIssue({
          code: "custom",
          path: ["value"],
          message: `${input.operation} 运算必须提供 value`,
        });
      }
    }

    /*
     * 平方根不允许负数。
     */
    if (
      input.operation === "sqrt" &&
      input.value !== undefined &&
      input.value < 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["value"],
        message: "平方根输入不能是负数",
      });
    }
  });

type AdvancedCalculatorInput = z.infer<typeof advancedCalculatorInputSchema>;

export const advancedCalculatorTool: Tool<AdvancedCalculatorInput> = {
  name: "advanced_calculator",

  description: [
    "执行安全的数学运算。",
    "operation=binary 时需要 left、operator、right；",
    "operation=sqrt、abs、round 时需要 value；",
    "round 可以额外传入 digits。",
    "复杂表达式需要拆分成多次工具调用。",
  ].join(" "),

  inputSchema: advancedCalculatorInputSchema,

  async execute(input) {
    switch (input.operation) {
      case "binary": {
        /*
         * Zod 的 superRefine 已经进行了验证，
         * 但 superRefine 不会让 TypeScript 自动缩窄类型，
         * 因此这里继续进行一次防御性检查。
         */
        if (
          input.left === undefined ||
          input.operator === undefined ||
          input.right === undefined
        ) {
          throw new Error("binary 运算缺少 left、operator 或 right");
        }

        switch (input.operator) {
          case "+":
            return String(input.left + input.right);

          case "-":
            return String(input.left - input.right);

          case "*":
            return String(input.left * input.right);

          case "/":
            if (input.right === 0) {
              throw new Error("除数不能为 0");
            }

            return String(input.left / input.right);

          case "^":
            return String(input.left ** input.right);
        }
      }

      case "sqrt": {
        if (input.value === undefined) {
          throw new Error("sqrt 运算缺少 value");
        }

        return String(Math.sqrt(input.value));
      }

      case "abs": {
        if (input.value === undefined) {
          throw new Error("abs 运算缺少 value");
        }

        return String(Math.abs(input.value));
      }

      case "round": {
        if (input.value === undefined) {
          throw new Error("round 运算缺少 value");
        }

        const digits = input.digits ?? 0;

        const factor = 10 ** digits;

        return String(Math.round(input.value * factor) / factor);
      }
    }
  },
};
