import { z } from "zod";

import type { Tool } from "../tool.js";
import type {
  SearchBackend,
  SearchPayload,
  SearchResultItem,
} from "./types.js";

const hybridSearchInputSchema = z.object({
  query: z.string().trim().min(1).describe("需要搜索的问题或关键词"),

  backend: z
    .enum(["auto", "tavily", "serpapi"])
    .default("auto")
    .describe("指定搜索后端；auto 表示自动选择"),

  strategy: z
    .enum(["fallback", "merge"])
    .default("fallback")
    .describe("fallback 顺序降级；merge 合并多源结果"),

  maxResults: z
    .number()
    .int()
    .min(1)
    .max(10)
    .default(3)
    .describe("最多返回的搜索结果数量"),
});

type HybridSearchInput = z.infer<typeof hybridSearchInputSchema>;

function formatPayload(payload: SearchPayload): string {
  const sections: string[] = [`搜索后端：${payload.backend}`];

  if (payload.answer) {
    sections.push(`直接答案：${payload.answer}`);
  }

  if (payload.results.length === 0) {
    sections.push("没有找到相关结果");

    return sections.join("\n\n");
  }

  const items = payload.results.map((item, index) => {
    return [
      `${index + 1}. ${item.title}`,
      item.content || "无摘要",
      `来源：${item.url}`,
    ].join("\n");
  });

  sections.push(items.join("\n\n"));

  return sections.join("\n\n");
}

function deduplicateResults(results: SearchResultItem[]): SearchResultItem[] {
  const seenUrls = new Set<string>();
  const uniqueResults: SearchResultItem[] = [];

  for (const result of results) {
    if (seenUrls.has(result.url)) {
      continue;
    }

    seenUrls.add(result.url);
    uniqueResults.push(result);
  }

  return uniqueResults;
}

function selectBackends(
  backends: SearchBackend[],
  requestedBackend: HybridSearchInput["backend"],
): SearchBackend[] {
  const availableBackends = backends.filter((backend) => backend.available);

  if (requestedBackend === "auto") {
    return availableBackends;
  }

  return availableBackends.filter(
    (backend) => backend.name === requestedBackend,
  );
}

async function searchWithFallback(
  backends: SearchBackend[],
  input: HybridSearchInput,
): Promise<string> {
  const failures: string[] = [];

  for (const backend of backends) {
    try {
      const result = await backend.search(input.query, input.maxResults);

      return formatPayload(result);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);

      failures.push(`${backend.name}: ${message}`);
    }
  }

  throw new Error(["所有搜索后端均执行失败。", ...failures].join("\n"));
}

async function searchAndMerge(
  backends: SearchBackend[],
  input: HybridSearchInput,
): Promise<string> {
  const settledResults = await Promise.allSettled(
    backends.map((backend) => {
      return backend.search(input.query, input.maxResults);
    }),
  );

  const successfulPayloads = settledResults
    .filter(
      (result): result is PromiseFulfilledResult<SearchPayload> =>
        result.status === "fulfilled",
    )
    .map((result) => result.value);

  if (successfulPayloads.length === 0) {
    const errors = settledResults
      .filter(
        (result): result is PromiseRejectedResult =>
          result.status === "rejected",
      )
      .map((result) => String(result.reason));

    throw new Error(["所有搜索后端均执行失败。", ...errors].join("\n"));
  }

  const mergedResults = deduplicateResults(
    successfulPayloads.flatMap((payload) => payload.results),
  ).slice(0, input.maxResults);

  const answers = successfulPayloads
    .map((payload) => payload.answer)
    .filter(
      (answer): answer is string => answer !== undefined && answer.length > 0,
    );

  return formatPayload({
    backend: successfulPayloads.map((payload) => payload.backend).join("+"),

    results: mergedResults,

    ...(answers.length === 0
      ? {}
      : {
          answer: answers.join("\n"),
        }),
  });
}

export function createHybridSearchTool(
  backends: SearchBackend[],
): Tool<HybridSearchInput> {
  return {
    name: "search",

    description: [
      "多源网页搜索工具。",
      "支持 Tavily 和 SerpAPI。",
      "可以自动故障降级或合并多个搜索源。",
    ].join(" "),

    inputSchema: hybridSearchInputSchema,

    async execute(input) {
      const selectedBackends = selectBackends(backends, input.backend);

      if (selectedBackends.length === 0) {
        throw new Error(
          [
            "没有可用的搜索后端。",
            "请配置 TAVILY_API_KEY 或 SERPAPI_API_KEY。",
          ].join(""),
        );
      }

      if (input.strategy === "merge") {
        return searchAndMerge(selectedBackends, input);
      }

      return searchWithFallback(selectedBackends, input);
    },
  };
}

import { TavilySearchBackend } from "./tavily-backend.js";
import { SerpApiSearchBackend } from "./serpapi-backend.js";

export function createHybridSearchToolFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): Tool<HybridSearchInput> {
  return createHybridSearchTool([
    new TavilySearchBackend(env.TAVILY_API_KEY),
    new SerpApiSearchBackend(env.SERPAPI_API_KEY),
  ]);
}
