import { describe, expect, it } from "vitest";
import {
  OpenAiCompatibleEmbeddingClient,
  type EmbeddingCreateRequest,
  type EmbeddingsApiClient,
} from "../src/memory/openai-compatible-embedding.js";

class FakeEmbeddingsApiClient implements EmbeddingsApiClient {
  public readonly requests: EmbeddingCreateRequest[] = [];

  public readonly embeddings = {
    create: async (
      request: EmbeddingCreateRequest,
    ): Promise<{
      data: Array<{ index: number; embedding: number[] }>;
    }> => {
      this.requests.push(request);

      /*
       * 故意倒序返回，用来证明实现会按照 index 恢复输入顺序。
       */
      return {
        data: request.input
          .map((text, index) => ({
            index,
            embedding: [text.length, index, request.dimensions ?? 3],
          }))
          .reverse(),
      };
    },
  };
}

describe("OpenAiCompatibleEmbeddingClient", () => {
  it("批量请求会按照响应 index 恢复顺序", async () => {
    const api = new FakeEmbeddingsApiClient();
    const client = new OpenAiCompatibleEmbeddingClient({
      client: api,
      model: "test-embedding",
      dimension: 3,
      batchSize: 10,
    });

    const vectors = await client.embedBatch(["a", "hello"]);

    expect(vectors).toEqual([
      [1, 0, 3],
      [5, 1, 3],
    ]);
    expect(api.requests[0]).toEqual({
      model: "test-embedding",
      input: ["a", "hello"],
      dimensions: 3,
      encoding_format: "float",
    });
  });

  it("超过 batchSize 时拆分请求且保持全局顺序", async () => {
    const api = new FakeEmbeddingsApiClient();
    const client = new OpenAiCompatibleEmbeddingClient({
      client: api,
      model: "test-embedding",
      dimension: 3,
      batchSize: 2,
    });

    const vectors = await client.embedBatch(["a", "bb", "ccc"]);

    expect(api.requests).toHaveLength(2);
    expect(vectors).toHaveLength(3);
    expect(vectors[0]?.[0]).toBe(1);
    expect(vectors[1]?.[0]).toBe(2);
    expect(vectors[2]?.[0]).toBe(3);
  });

  it("固定维度模型可以不发送 dimensions 参数", async () => {
    const api = new FakeEmbeddingsApiClient();
    const client = new OpenAiCompatibleEmbeddingClient({
      client: api,
      model: "fixed-dimension-model",
      dimension: 3,
      sendDimensions: false,
    });

    await client.embed("hello");

    expect(api.requests[0]).not.toHaveProperty("dimensions");
  });

  it("拒绝空文本和错误维度", async () => {
    const api = new FakeEmbeddingsApiClient();
    const client = new OpenAiCompatibleEmbeddingClient({
      client: api,
      model: "test-embedding",
      dimension: 4,
    });

    await expect(client.embed("   ")).rejects.toThrow("Embedding 文本不能为空");

    await expect(client.embed("hello")).rejects.toThrow("Embedding 维度不匹配");
  });
});
