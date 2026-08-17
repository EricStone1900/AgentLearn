import { z } from "zod";
import type { Tool } from "./tool.js";

const searchInputSchema = z.object({
  query: z.string().min(1),
});

type SearchInput = z.infer<typeof searchInputSchema>;

interface SerpApiResult {
  error?: string;

  answer_box?: {
    answer?: string;
    snippet?: string;
  };

  knowledge_graph?: {
    description?: string;
  };

  organic_results?: Array<{
    title?: string;
    snippet?: string;
    link?: string;
  }>;
}

export function createSearchTool(apiKey: string): Tool<SearchInput> {
  return {
    name: "search",

    description: [
      "搜索互联网中的实时信息、新闻和模型知识库中可能不存在的事实。",
      '参数格式：{"query":"搜索关键词"}。',
    ].join(" "),

    inputSchema: searchInputSchema,

    async execute({ query }) {
      const url = new URL("https://serpapi.com/search.json");

      url.searchParams.set("engine", "google");
      url.searchParams.set("q", query);
      url.searchParams.set("api_key", apiKey);
      url.searchParams.set("hl", "zh-cn");
      url.searchParams.set("gl", "cn");

      const response = await fetch(url, {
        signal: AbortSignal.timeout(15_000),
      });

      if (!response.ok) {
        throw new Error(`搜索服务返回 HTTP ${response.status}`);
      }

      const data = (await response.json()) as SerpApiResult;

      if (data.error) {
        throw new Error(data.error);
      }

      if (data.answer_box?.answer) {
        return data.answer_box.answer;
      }

      if (data.answer_box?.snippet) {
        return data.answer_box.snippet;
      }

      if (data.knowledge_graph?.description) {
        return data.knowledge_graph.description;
      }

      const organicResults = data.organic_results?.slice(0, 3) ?? [];

      if (organicResults.length === 0) {
        return "没有找到相关搜索结果";
      }

      return organicResults
        .map((item, index) => {
          return [
            `${index + 1}. ${item.title ?? "无标题"}`,
            item.snippet ?? "无摘要",
            item.link ?? "",
          ]
            .filter(Boolean)
            .join("\n");
        })
        .join("\n\n");
    },
  };
}
