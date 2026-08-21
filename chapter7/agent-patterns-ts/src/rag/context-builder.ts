import type { RagSearchResult } from "./schemas.js";

export interface BuiltRagContext {
  context: string;
  citations: Array<{
    index: number;
    documentId: string;
    source: string;
    headingPath?: string;
    startOffset: number;
    endOffset: number;
    score: number;
  }>;
}

export function buildRagContext(
  results: RagSearchResult[],
  maxCharacters = 6_000,
): BuiltRagContext {
  const parts: string[] = [];
  const citations: BuiltRagContext["citations"] = [];
  let used = 0;

  for (const result of results) {
    const index = citations.length + 1;
    const prefix = `[S${index}] 来源：${result.document.source}` +
      (result.chunk.headingPath ? `；章节：${result.chunk.headingPath}` : "") +
      "\n";
    const remaining = maxCharacters - used - prefix.length;
    if (remaining <= 0) break;
    const content = result.chunk.content.slice(0, remaining);
    if (!content) break;
    const block = `${prefix}${content}`;
    parts.push(block);
    used += block.length + 2;
    citations.push({
      index,
      documentId: result.document.id,
      source: result.document.source,
      ...(result.chunk.headingPath ? { headingPath: result.chunk.headingPath } : {}),
      startOffset: result.chunk.startOffset,
      endOffset: result.chunk.endOffset,
      score: result.score,
    });
  }

  return { context: parts.join("\n\n"), citations };
}