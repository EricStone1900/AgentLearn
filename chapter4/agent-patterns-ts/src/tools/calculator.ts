import { z } from "zod";
import type { Tool } from "./tool.js";

const calculatorInputSchema = z.object({
  left: z.number(),
  operator: z.enum(["+", "-", "*", "/"]),
  right: z.number(),
});

type CalculatorInput = z.infer<typeof calculatorInputSchema>;

export const calculatorTool: Tool<CalculatorInput> = {
  name: "calculator",

  description: [
    "对两个数字进行加、减、乘、除运算。",
    "参数必须是 JSON：",
    '{"left":数字,"operator":"+"|"-"|"*"|"/","right":数字}',
    "一次只能进行一个二元运算。",
  ].join(" "),

  inputSchema: calculatorInputSchema,

  async execute(input) {
    let result: number;

    switch (input.operator) {
      case "+":
        result = input.left + input.right;
        break;

      case "-":
        result = input.left - input.right;
        break;

      case "*":
        result = input.left * input.right;
        break;

      case "/":
        if (input.right === 0) {
          throw new Error("除数不能为 0");
        }

        result = input.left / input.right;
        break;
    }

    return String(result);
  },
};
