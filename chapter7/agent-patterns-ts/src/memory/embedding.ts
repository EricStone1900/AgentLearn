export interface EmbeddingClient {
  readonly dimension: number;
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
}

function tokens(text: string): string[] {
  return text.toLowerCase().match(/[\p{Script=Han}]|[\p{L}\p{N}_]+/gu) ?? [];
}

function stableHash(value: string): number {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export class HashEmbeddingClient implements EmbeddingClient {
  public constructor(public readonly dimension = 128) {
    if (!Number.isInteger(dimension) || dimension <= 0) {
      throw new Error("向量维度必须是正整数");
    }
  }

  public async embed(text: string): Promise<number[]> {
    const vector = Array<number>(this.dimension).fill(0);

    for (const token of tokens(text)) {
      const index = stableHash(token) % this.dimension;
      vector[index] = (vector[index] ?? 0) + 1;
    }

    const norm = Math.sqrt(vector.reduce((sum, value) => sum + value ** 2, 0));
    return norm === 0 ? vector : vector.map((value) => value / norm);
  }

  public async embedBatch(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map((text) => this.embed(text)));
  }
}
