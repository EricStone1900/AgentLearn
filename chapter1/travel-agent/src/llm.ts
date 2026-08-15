import OpenAI from "openai";

const apiKey = process.env.OPENAI_API_KEY;
const baseURL = process.env.OPENAI_BASE_URL;
const model = process.env.OPENAI_MODEL;

if (!apiKey) {
  throw new Error("没有配置 OPENAI_API_KEY");
}

if (!model) {
  throw new Error("没有配置 OPENAI_MODEL");
}

const client = new OpenAI({
  apiKey,
  ...(baseURL ? { baseURL } : {})
});

export async function generate(
  prompt: string,
  systemPrompt: string
): Promise<string> {
  console.log("正在调用大语言模型……");

  const response = await client.responses.create({
    model,
    instructions: systemPrompt,
    input: prompt,
    max_output_tokens: 500
  });

  const text = response.output_text.trim();

  if (!text) {
    throw new Error("模型返回了空内容");
  }

  return text;
}