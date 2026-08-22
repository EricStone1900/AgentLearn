import { open, readFile, realpath, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, dirname, extname, relative, resolve, sep } from "node:path";
import {
  getDocument,
  type PDFDocumentProxy,
} from "pdfjs-dist/legacy/build/pdf.mjs";
import {
  DocumentConversionError,
  type ConvertedDocument,
  type DocumentConverter,
} from "./document-converter.js";

export interface PdfDocumentConverterOptions {
  allowedRoot: string;
  maxFileBytes: number;
  maxPages: number;
  minExtractedCharacters?: number;
}

interface ExtractedPage {
  pageNumber: number;
  text: string;
  characterCount: number;
}

const require = createRequire(import.meta.url);
const pdfJsModulePath = require.resolve(
  "pdfjs-dist/legacy/build/pdf.mjs",
);
const pdfJsPackageRoot = resolve(dirname(pdfJsModulePath), "../..");

function resolvePdfJsAssetDirectory(directoryName: string): string {
  const directoryPath = resolve(pdfJsPackageRoot, directoryName);

  return directoryPath.endsWith(sep) ? directoryPath : `${directoryPath}${sep}`;
}

const standardFontDataUrl = resolvePdfJsAssetDirectory("standard_fonts");
const cMapUrl = resolvePdfJsAssetDirectory("cmaps");
const wasmUrl = resolvePdfJsAssetDirectory("wasm");

function isInside(root: string, candidate: string): boolean {
  const pathFromRoot = relative(root, candidate);

  return (
    pathFromRoot === "" ||
    (pathFromRoot !== ".." && !pathFromRoot.startsWith(`..${sep}`))
  );
}

function normalizeTitle(value: string): string {
  return value
    .replace(/[\r\n]+/gu, " ")
    .replace(/\s+/gu, " ")
    .replace(/#/gu, "\\#")
    .trim();
}

function readMetadataString(info: unknown, key: string): string | undefined {
  if (!info || typeof info !== "object" || !(key in info)) {
    return undefined;
  }

  const value = (info as Record<string, unknown>)[key];

  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }

  return value.trim();
}

function isCjkCharacter(value: string): boolean {
  return /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(
    value,
  );
}

function shouldInsertSpace(current: string, next: string): boolean {
  const lastCharacter = current.at(-1) ?? "";

  const firstCharacter = next.at(0) ?? "";

  if (!lastCharacter || !firstCharacter) {
    return false;
  }

  if (isCjkCharacter(lastCharacter) && isCjkCharacter(firstCharacter)) {
    return false;
  }

  if (/^[,.;:!?，。；：！？、）】》”’]/u.test(firstCharacter)) {
    return false;
  }

  if (/[（【《“‘]$/u.test(lastCharacter)) {
    return false;
  }

  return true;
}

function appendSegment(current: string, segment: string): string {
  if (!current) {
    return segment;
  }

  return shouldInsertSpace(current, segment)
    ? `${current} ${segment}`
    : `${current}${segment}`;
}

async function extractPageText(
  pdf: PDFDocumentProxy,
  pageNumber: number,
): Promise<ExtractedPage> {
  const page = await pdf.getPage(pageNumber);

  try {
    const content = await page.getTextContent();

    const lines: string[] = [];

    let currentLine = "";
    let previousY: number | undefined;

    const flushLine = (): void => {
      const normalized = currentLine.trim();

      if (normalized) {
        lines.push(normalized);
      }

      currentLine = "";
      previousY = undefined;
    };

    for (const item of content.items) {
      if (!("str" in item)) {
        continue;
      }

      const segment = item.str
        .replace(/\u0000/gu, "")
        .replace(/\u00a0/gu, " ")
        .replace(/[ \t]+/gu, " ")
        .trim();

      const y =
        typeof item.transform[5] === "number" ? item.transform[5] : undefined;

      const movedToNewLine =
        currentLine.length > 0 &&
        previousY !== undefined &&
        y !== undefined &&
        Math.abs(y - previousY) > 2;

      if (movedToNewLine) {
        flushLine();
      }

      if (segment) {
        currentLine = appendSegment(currentLine, segment);
      }

      if (item.hasEOL) {
        flushLine();
      } else {
        previousY = y;
      }
    }

    flushLine();

    const text = lines
      .join("\n")
      .replace(/\n{3,}/gu, "\n\n")
      .trim();

    return {
      pageNumber,
      text,
      characterCount: text.replace(/\s/gu, "").length,
    };
  } finally {
    page.cleanup();
  }
}

async function validatePdfSignature(filePath: string): Promise<void> {
  const file = await open(filePath, "r");

  try {
    const signature = Buffer.alloc(5);

    const { bytesRead } = await file.read(signature, 0, signature.length, 0);

    if (bytesRead !== 5 || signature.toString("ascii") !== "%PDF-") {
      throw new DocumentConversionError(
        "INVALID_PDF_SIGNATURE",
        "文件扩展名是 .pdf，但文件头不是有效的 PDF",
      );
    }
  } finally {
    await file.close();
  }
}

function mapPdfError(error: unknown): DocumentConversionError {
  if (error instanceof DocumentConversionError) {
    return error;
  }

  const errorName =
    error &&
    typeof error === "object" &&
    "name" in error &&
    typeof error.name === "string"
      ? error.name
      : "";

  if (errorName === "PasswordException") {
    return new DocumentConversionError(
      "PDF_ENCRYPTED",
      "暂不支持带密码或加密的 PDF",
      {
        cause: error,
      },
    );
  }

  const message = error instanceof Error ? error.message : String(error);

  return new DocumentConversionError(
    "PDF_PARSE_FAILED",
    `PDF 解析失败：${message}`,
    {
      cause: error,
    },
  );
}

export class PdfDocumentConverter implements DocumentConverter {
  private constructor(
    private readonly allowedRoot: string,
    private readonly options: Omit<
      Required<PdfDocumentConverterOptions>,
      "allowedRoot"
    >,
  ) {}

  public static async create(
    options: PdfDocumentConverterOptions,
  ): Promise<PdfDocumentConverter> {
    if (!Number.isInteger(options.maxFileBytes) || options.maxFileBytes < 1) {
      throw new Error("maxFileBytes 必须是正整数");
    }

    if (!Number.isInteger(options.maxPages) || options.maxPages < 1) {
      throw new Error("maxPages 必须是正整数");
    }

    const minExtractedCharacters = options.minExtractedCharacters ?? 20;

    if (
      !Number.isInteger(minExtractedCharacters) ||
      minExtractedCharacters < 0
    ) {
      throw new Error("minExtractedCharacters 必须是非负整数");
    }

    const allowedRoot = await realpath(resolve(options.allowedRoot));

    return new PdfDocumentConverter(allowedRoot, {
      maxFileBytes: options.maxFileBytes,
      maxPages: options.maxPages,
      minExtractedCharacters,
    });
  }

  public async convert(filePath: string): Promise<ConvertedDocument> {
    let actualPath: string;

    try {
      actualPath = await realpath(resolve(filePath));
    } catch (error: unknown) {
      throw new DocumentConversionError(
        "FILE_NOT_FOUND",
        `PDF 文件不存在：${filePath}`,
        {
          cause: error,
        },
      );
    }

    if (!isInside(this.allowedRoot, actualPath)) {
      throw new DocumentConversionError(
        "PATH_OUTSIDE_ROOT",
        "PDF 路径超出允许的上传目录",
      );
    }

    const fileInfo = await stat(actualPath);

    if (!fileInfo.isFile()) {
      throw new DocumentConversionError("NOT_A_FILE", "PDF 路径不是普通文件");
    }

    if (extname(actualPath).toLowerCase() !== ".pdf") {
      throw new DocumentConversionError(
        "UNSUPPORTED_FILE_TYPE",
        "只支持 .pdf 文件",
      );
    }

    if (fileInfo.size > this.options.maxFileBytes) {
      throw new DocumentConversionError(
        "FILE_TOO_LARGE",
        [
          "PDF 文件超过大小限制。",
          `当前：${fileInfo.size} 字节。`,
          `限制：${this.options.maxFileBytes} 字节。`,
        ].join(""),
      );
    }

    await validatePdfSignature(actualPath);

    const fileBytes = await readFile(actualPath);

    const loadingTask = getDocument({
      data: new Uint8Array(
        fileBytes.buffer,
        fileBytes.byteOffset,
        fileBytes.byteLength,
      ),

      /*
       * 对格式错误的 PDF 使用更严格行为，
       * 避免在明显损坏的文件上继续处理。
       */
      stopAtErrors: true,

      /*
       * Node.js 环境不会自动定位 pdfjs-dist 随包提供的资源。
       * 显式传入这些目录，避免标准字体、CMap 或 wasm 按需加载时告警。
       */
      standardFontDataUrl,
      cMapUrl,
      cMapPacked: true,
      wasmUrl,
    });

    let pdf: PDFDocumentProxy | undefined;

    try {
      pdf = await loadingTask.promise;

      if (pdf.numPages > this.options.maxPages) {
        throw new DocumentConversionError(
          "PDF_TOO_MANY_PAGES",
          [
            "PDF 页数超过限制。",
            `当前：${pdf.numPages} 页。`,
            `限制：${this.options.maxPages} 页。`,
          ].join(""),
        );
      }

      let metadataInfo: unknown | undefined;

      try {
        const metadata = await pdf.getMetadata();

        metadataInfo = metadata.info;
      } catch {
        /*
         * 元数据不是文本提取的必要条件。
         * 元数据损坏时仍允许继续读取页面。
         */
      }

      const fallbackTitle = basename(actualPath, extname(actualPath));

      const metadataTitle = readMetadataString(metadataInfo, "Title");

      const title = normalizeTitle(metadataTitle ?? fallbackTitle);

      const pages: ExtractedPage[] = [];

      /*
       * 顺序处理页面，避免大文档同时将所有页面
       * 加载到内存。
       */
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
        pages.push(await extractPageText(pdf, pageNumber));
      }

      const extractedCharacters = pages.reduce((total, page) => {
        return total + page.characterCount;
      }, 0);

      if (extractedCharacters < this.options.minExtractedCharacters) {
        throw new DocumentConversionError(
          "PDF_TEXT_EMPTY",
          [
            "PDF 中没有提取到足够的文本。",
            "该文件可能是扫描件、图片型 PDF 或空文档。",
            `提取字符数：${extractedCharacters}。`,
          ].join(""),
        );
      }

      const source = relative(this.allowedRoot, actualPath);

      const markdownParts: string[] = [
        `# ${title}`,
        "",
        `> 来源：${source}`,
        `> 页数：${pdf.numPages}`,
        "",
      ];

      for (const page of pages) {
        if (!page.text) {
          continue;
        }

        markdownParts.push(`## 第 ${page.pageNumber} 页`, "", page.text, "");
      }

      const markdown = markdownParts.join("\n").trim();

      return {
        title,
        source,
        markdown,
        pageCount: pdf.numPages,

        metadata: {
          inputType: "pdf",
          fileExtension: ".pdf",
          fileSizeBytes: fileInfo.size,
          pageCount: pdf.numPages,
          extractedCharacters,

          pageCharacterCounts: pages.map((page) => {
            return {
              pageNumber: page.pageNumber,
              characterCount: page.characterCount,
            };
          }),

          ...(readMetadataString(metadataInfo, "Author")
            ? {
                author: readMetadataString(metadataInfo, "Author"),
              }
            : {}),

          ...(readMetadataString(metadataInfo, "Subject")
            ? {
                subject: readMetadataString(metadataInfo, "Subject"),
              }
            : {}),

          ...(readMetadataString(metadataInfo, "Keywords")
            ? {
                keywords: readMetadataString(metadataInfo, "Keywords"),
              }
            : {}),
        },
      };
    } catch (error: unknown) {
      throw mapPdfError(error);
    } finally {
      /*
       * pdfjs-dist 6.x 将完整的生命周期销毁操作放在
       * PDFDocumentLoadingTask 上。无论文档加载成功还是失败，
       * 都从这里释放 transport、worker 和页面缓存。
       */
      await loadingTask.destroy();
    }
  }
}
