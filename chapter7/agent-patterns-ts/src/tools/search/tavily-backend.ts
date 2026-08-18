import { z } from "zod";

import type { SearchBackend, SearchPayload } from "./types.js";

const tavilyResponseSchema = z.object({
  answer: z.string().nullish(),

  results: z
    .array(
      z.object({
        title: z.string().default("无标题"),
        url: z.string().url(),
        content: z.string().default(""),
      }),
    )
    .default([]),
});

export class TavilySearchBackend implements SearchBackend {
  public readonly name = "tavily";
  public readonly available: boolean;

  public constructor(private readonly apiKey: string | undefined) {
    this.available = Boolean(apiKey?.trim());
  }

  public async search(
    query: string,
    maxResults: number,
  ): Promise<SearchPayload> {
    if (!this.apiKey) {
      throw new Error("TAVILY_API_KEY 未配置");
    }

    const response = await fetch("https://api.tavily.com/search", {
      method: "POST",

      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },

      body: JSON.stringify({
        query,
        search_depth: "basic",
        include_answer: true,
        max_results: maxResults,
      }),

      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      throw new Error(`Tavily 返回 HTTP ${response.status}`);
    }

    const rawData: unknown = await response.json();

    const data = tavilyResponseSchema.parse(rawData);

    return {
      backend: this.name,

      results: data.results.map((item) => ({
        title: item.title,
        url: item.url,
        content: item.content,
      })),

      ...(data.answer
        ? {
            answer: data.answer,
          }
        : {}),
    };
  }
}
