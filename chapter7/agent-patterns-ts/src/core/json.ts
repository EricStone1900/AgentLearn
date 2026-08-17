import type { ZodType } from "zod";

export function parseJson<T>(raw: string, schema: ZodType<T>): T {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

  let parsed: unknown;

  try {
    parsed = JSON.parse(cleaned);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);

    throw new Error(`模型输出不是合法 JSON：${message}`);
  }

  return schema.parse(parsed);
}
