import { createChunkId, sha256 } from "./ids.js";
import type { LoadedRagDocument, RagChunk } from "./schemas.js";

export interface MarkdownSplitterOptions {
  chunkTokens: number;
  overlapTokens: number;
  minimumChunkTokens?: number;
}

interface Paragraph {
  content: string;
  headingPath?: string;
  startOffset: number;
  endOffset: number;
  tokenCount: number;
}

export function approximateTokenCount(text: string): number {
  const cjkCount = text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu)?.length ?? 0;
  const otherText = text.replace(
    /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu,
    " ",
  );
  const otherTokens = otherText.match(/[\p{L}\p{N}_+-]+|[^\s\p{L}\p{N}]/gu)?.length ?? 0;
  return cjkCount + otherTokens;
}

function splitOversizedParagraph(paragraph: Paragraph, limit: number): Paragraph[] {
  if (paragraph.tokenCount <= limit) return [paragraph];

  const pieces: Paragraph[] = [];
  let start = 0;
  while (start < paragraph.content.length) {
    let end = start;
    let tokens = 0;
    while (end < paragraph.content.length && tokens < limit) {
      const codePoint = paragraph.content.codePointAt(end);
      if (codePoint === undefined) break;
      const character = String.fromCodePoint(codePoint);
      tokens += Math.max(1, approximateTokenCount(character));
      end += character.length;
    }

    const candidate = paragraph.content.slice(start, end);
    const naturalBreak = Math.max(
      candidate.lastIndexOf("。"),
      candidate.lastIndexOf("！"),
      candidate.lastIndexOf("？"),
      candidate.lastIndexOf("\n"),
      candidate.lastIndexOf(" "),
    );
    if (naturalBreak > candidate.length * 0.6) end = start + naturalBreak + 1;

    const content = paragraph.content.slice(start, end).trim();
    if (content) {
      pieces.push({
        content,
        ...(paragraph.headingPath ? { headingPath: paragraph.headingPath } : {}),
        startOffset: paragraph.startOffset + start,
        endOffset: paragraph.startOffset + end,
        tokenCount: approximateTokenCount(content),
      });
    }
    start = Math.max(start + 1, end);
  }
  return pieces;
}

function parseParagraphs(markdown: string, limit: number): Paragraph[] {
  const lines = markdown.split(/(?<=\n)/u);
  const headingStack: string[] = [];
  const paragraphs: Paragraph[] = [];
  let buffer = "";
  let bufferStart = 0;
  let offset = 0;

  const flush = (): void => {
    const leading = buffer.length - buffer.trimStart().length;
    const content = buffer.trim();
    if (content) {
      const paragraph: Paragraph = {
        content,
        ...(headingStack.length > 0
          ? { headingPath: headingStack.join(" > ") }
          : {}),
        startOffset: bufferStart + leading,
        endOffset: bufferStart + leading + content.length,
        tokenCount: approximateTokenCount(content),
      };
      paragraphs.push(...splitOversizedParagraph(paragraph, limit));
    }
    buffer = "";
  };

  for (const lineWithEnding of lines) {
    const line = lineWithEnding.replace(/\r?\n$/u, "");
    const heading = /^(#{1,6})\s+(.+?)\s*$/u.exec(line);

    if (heading) {
      flush();
      const level = heading[1]?.length ?? 1;
      const title = heading[2]?.trim() ?? "";
      headingStack.length = level - 1;
      headingStack[level - 1] = title;
    } else if (!line.trim()) {
      flush();
    } else {
      if (!buffer) bufferStart = offset;
      buffer += lineWithEnding;
    }
    offset += lineWithEnding.length;
  }
  flush();
  return paragraphs;
}

function cleanForEmbedding(text: string): string {
  return text
    .replace(/^#{1,6}\s+/gmu, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/gu, "$1")
    .replace(/[*_`~]/gu, "")
    .replace(/[ \t]+/gu, " ")
    .trim();
}

export class MarkdownSplitter {
  private readonly options: Required<MarkdownSplitterOptions>;

  public constructor(options: MarkdownSplitterOptions) {
    this.options = {
      ...options,
      minimumChunkTokens: options.minimumChunkTokens ?? 1,
    };
    if (!Number.isInteger(this.options.chunkTokens) || this.options.chunkTokens < 1) {
      throw new Error("chunkTokens 必须是正整数");
    }
    if (
      !Number.isInteger(this.options.overlapTokens) ||
      this.options.overlapTokens < 0 ||
      this.options.overlapTokens >= this.options.chunkTokens
    ) {
      throw new Error("overlapTokens 必须大于等于 0 且小于 chunkTokens");
    }
    if (
      !Number.isInteger(this.options.minimumChunkTokens) ||
      this.options.minimumChunkTokens < 1
    ) {
      throw new Error("minimumChunkTokens 必须是正整数");
    }
  }

  public split(document: LoadedRagDocument): RagChunk[] {
    const paragraphs = parseParagraphs(document.markdown, this.options.chunkTokens);
    const groups: Paragraph[][] = [];
    let current: Paragraph[] = [];
    let currentTokens = 0;

    for (const paragraph of paragraphs) {
      if (current.length > 0 && currentTokens + paragraph.tokenCount > this.options.chunkTokens) {
        groups.push(current);
        const overlap: Paragraph[] = [];
        let overlapTokens = 0;
        for (let index = current.length - 1; index >= 0; index -= 1) {
          const item = current[index];
          if (!item || overlapTokens + item.tokenCount > this.options.overlapTokens) break;
          overlap.unshift(item);
          overlapTokens += item.tokenCount;
        }
        current = overlap;
        currentTokens = overlapTokens;
      }
      current.push(paragraph);
      currentTokens += paragraph.tokenCount;
    }
    if (current.length > 0) groups.push(current);

    return groups
      .map((group, chunkIndex): RagChunk => {
        const content = group.map((item) => item.content).join("\n\n");
        const headingPath = [...group]
          .reverse()
          .find((item) => item.headingPath)?.headingPath;
        const contentHash = sha256(content);
        const embeddingText = cleanForEmbedding(
          [headingPath, content].filter(Boolean).join("\n"),
        );
        return {
          id: createChunkId(document.id, chunkIndex, contentHash),
          documentId: document.id,
          namespace: document.namespace,
          chunkIndex,
          content,
          embeddingText,
          ...(headingPath ? { headingPath } : {}),
          startOffset: group[0]?.startOffset ?? 0,
          endOffset: group.at(-1)?.endOffset ?? content.length,
          tokenCount: approximateTokenCount(content),
          contentHash,
          metadata: structuredClone(document.metadata),
        };
      })
      .filter((chunk) => chunk.tokenCount >= this.options.minimumChunkTokens);
  }
}