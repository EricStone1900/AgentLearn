import { describe, expect, it } from "vitest";

import { createHybridSearchTool } from "../src/tools/search/hybrid-search.js";

import type {
  SearchBackend,
  SearchPayload,
} from "../src/tools/search/types.js";

class FakeSearchBackend implements SearchBackend {
  public readonly available = true;

  public constructor(
    public readonly name: string,
    private readonly response: SearchPayload | Error,
  ) {}

  public async search(): Promise<SearchPayload> {
    if (this.response instanceof Error) {
      throw this.response;
    }

    return this.response;
  }
}

it("第一个后端失败后使用第二个后端", async () => {
  const tool = createHybridSearchTool([
    new FakeSearchBackend("tavily", new Error("Tavily 暂时不可用")),

    new FakeSearchBackend("serpapi", {
      backend: "serpapi",

      results: [
        {
          title: "测试结果",
          url: "https://example.com",
          content: "这是降级后的搜索结果",
        },
      ],
    }),
  ]);

  const result = await tool.execute({
    query: "测试查询",
    backend: "auto",
    strategy: "fallback",
    maxResults: 3,
  });

  expect(result).toContain("serpapi");
  expect(result).toContain("测试结果");
});

it("能够合并多个后端的搜索结果", async () => {
  const tool = createHybridSearchTool([
    new FakeSearchBackend("tavily", {
      backend: "tavily",

      results: [
        {
          title: "结果 A",
          url: "https://example.com/a",
          content: "内容 A",
        },
      ],
    }),

    new FakeSearchBackend("serpapi", {
      backend: "serpapi",

      results: [
        {
          title: "结果 B",
          url: "https://example.com/b",
          content: "内容 B",
        },
      ],
    }),
  ]);

  const result = await tool.execute({
    query: "测试查询",
    backend: "auto",
    strategy: "merge",
    maxResults: 3,
  });

  expect(result).toContain("结果 A");
  expect(result).toContain("结果 B");
});
