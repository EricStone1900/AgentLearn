function clamp(value: number, minimum = 0, maximum = 1): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function tokenize(text: string): string[] {
  return (
    text
      .toLowerCase()
      .match(/[\p{Script=Han}]|[\p{Script=Latin}\p{N}_+-]+/gu) ?? []
  );
}

export function importanceWeight(importance: number): number {
  return 0.8 + clamp(importance) * 0.4;
}

export function recencyScore(
  timestamp: string,
  now: Date = new Date(),
): number {
  const timestampMs = Date.parse(timestamp);

  if (!Number.isFinite(timestampMs)) {
    throw new Error(`非法记忆时间：${timestamp}`);
  }

  const ageMs = Math.max(0, now.getTime() - timestampMs);
  const ageDays = ageMs / (24 * 60 * 60 * 1000);

  return 1 / (1 + ageDays);
}

export function lexicalSimilarity(query: string, content: string): number {
  const queryTokens = new Set(tokenize(query));
  const contentTokens = new Set(tokenize(content));

  if (queryTokens.size === 0 || contentTokens.size === 0) {
    return 0;
  }

  let intersection = 0;

  for (const token of queryTokens) {
    if (contentTokens.has(token)) {
      intersection += 1;
    }
  }

  const union = new Set([...queryTokens, ...contentTokens]).size;

  return union === 0 ? 0 : intersection / union;
}

export function cosineSimilarity(left: number[], right: number[]): number {
  if (left.length !== right.length || left.length === 0) {
    throw new Error("余弦相似度要求两个非空向量维度相同");
  }

  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;

  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;

    dot += leftValue * rightValue;
    leftNorm += leftValue ** 2;
    rightNorm += rightValue ** 2;
  }

  if (leftNorm === 0 || rightNorm === 0) {
    return 0;
  }

  return clamp(dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm)));
}
