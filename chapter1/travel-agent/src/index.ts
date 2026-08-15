// 测试1
// import { getWeather } from "./tools.js";

// const result = await getWeather("北京");

// console.log(result);

// 测试2
// import "dotenv/config";
// import { getAttraction } from "./tools.js";

// const result = await getAttraction(
//   "北京",
//   "晴朗，气温 26℃"
// );

// console.log(result);

// 测试3
// import "dotenv/config";
// import { generate } from "./llm.js";

// const result = await generate(
//   "请回复：连接成功",
//   "你是一个测试助手。"
// );

// console.log(result);

import "dotenv/config";
import { runAgent } from "./agent.js";

const userInput =
  process.argv.slice(2).join(" ") ||
  "你好，请帮我查询一下今天北京的天气，然后根据天气推荐一个合适的旅游景点。";

try {
  const answer = await runAgent(userInput, 5);

  console.log("\n" + "=".repeat(60));
  console.log(`最终答案：\n${answer}`);
} catch (error) {
  const message =
    error instanceof Error ? error.message : String(error);

  console.error(`\n程序运行失败：${message}`);
  process.exitCode = 1;
}