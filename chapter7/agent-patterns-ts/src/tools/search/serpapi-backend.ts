import { z } from "zod";

import type { SearchBackend, SearchPayload } from "./types.js";

const serpApiResponseSchema = z.object({
  error: z.string().optional(),

  answer_box: z
    .object({
      answer: z.string().optional(),
      snippet: z.string().optional(),
    })
    .optional(),

  knowledge_graph: z
    .object({
      description: z.string().optional(),
    })
    .optional(),

  organic_results: z
    .array(
      z.object({
        title: z.string().optional(),
        snippet: z.string().optional(),
        link: z.string().url().optional(),
      }),
    )
    .optional(),
});

export class SerpApiSearchBackend implements SearchBackend {
  public readonly name = "serpapi";
  public readonly available: boolean;

  public constructor(private readonly apiKey: string | undefined) {
    this.available = Boolean(apiKey?.trim());
  }

  public async search(
    query: string,
    maxResults: number,
  ): Promise<SearchPayload> {
    if (!this.apiKey) {
      throw new Error("SERPAPI_API_KEY 未配置");
    }

    const url = new URL("https://serpapi.com/search.json");

    url.searchParams.set("engine", "google");
    url.searchParams.set("q", query);
    url.searchParams.set("api_key", this.apiKey);
    url.searchParams.set("hl", "zh-cn");
    url.searchParams.set("gl", "cn");
    url.searchParams.set("num", String(maxResults));

    const response = await fetch(url, {
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      throw new Error(`SerpAPI 返回 HTTP ${response.status}`);
    }

    const rawData: unknown = await response.json();

    const data = serpApiResponseSchema.parse(rawData);

    if (data.error) {
      throw new Error(data.error);
    }

    const directAnswer =
      data.answer_box?.answer ??
      data.answer_box?.snippet ??
      data.knowledge_graph?.description;

    const results = (data.organic_results ?? [])
      .slice(0, maxResults)
      .filter(
        (item): item is typeof item & { link: string } =>
          item.link !== undefined,
      )
      .map((item) => ({
        title: item.title ?? "无标题",
        url: item.link,
        content: item.snippet ?? "",
      }));

    return {
      backend: this.name,
      results,

      ...(directAnswer === undefined
        ? {}
        : {
            answer: directAnswer,
          }),
    };
  }
}
