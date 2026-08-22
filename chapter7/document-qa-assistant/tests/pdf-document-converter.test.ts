import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PdfDocumentConverter } from "../src/documents/pdf-document-converter.js";

interface CreatePdfOptions {
  title?: string;
  pageTexts?: string[];
  blank?: boolean;
}

async function createPdfFile(
  filePath: string,
  options: CreatePdfOptions = {},
): Promise<void> {
  const document = await PDFDocument.create();

  if (options.title) {
    document.setTitle(options.title);
  }

  const font = await document.embedFont(StandardFonts.Helvetica);

  if (options.blank) {
    document.addPage([595, 842]);
  } else {
    const pageTexts = options.pageTexts ?? [
      "RAG retrieves relevant document chunks.",
    ];

    for (const pageText of pageTexts) {
      const page = document.addPage([595, 842]);

      page.drawText(pageText, {
        x: 50,
        y: 780,
        size: 14,
        font,
      });
    }
  }

  const bytes = await document.save();

  await writeFile(filePath, bytes);
}

describe("PdfDocumentConverter", () => {
  let allowedRoot: string;
  let outsideRoot: string;

  beforeEach(async () => {
    allowedRoot = await mkdtemp(join(tmpdir(), "document-qa-pdf-root-"));

    outsideRoot = await mkdtemp(join(tmpdir(), "document-qa-pdf-outside-"));
  });

  afterEach(async () => {
    await Promise.all([
      rm(allowedRoot, {
        recursive: true,
        force: true,
      }),

      rm(outsideRoot, {
        recursive: true,
        force: true,
      }),
    ]);
  });

  async function createConverter(
    overrides: Partial<{
      maxFileBytes: number;
      maxPages: number;
      minExtractedCharacters: number;
    }> = {},
  ): Promise<PdfDocumentConverter> {
    return PdfDocumentConverter.create({
      allowedRoot,

      maxFileBytes: overrides.maxFileBytes ?? 5 * 1024 * 1024,

      maxPages: overrides.maxPages ?? 20,

      minExtractedCharacters: overrides.minExtractedCharacters ?? 1,
    });
  }

  it("将多页 PDF 转换成按页 Markdown", async () => {
    const pdfPath = join(allowedRoot, "rag-guide.pdf");

    await createPdfFile(pdfPath, {
      title: "RAG Guide",

      pageTexts: [
        "RAG retrieves relevant document chunks.",
        "The language model answers from retrieved evidence.",
      ],
    });

    const converter = await createConverter();

    const result = await converter.convert(pdfPath);

    expect(result.title).toBe("RAG Guide");

    expect(result.source).toBe("rag-guide.pdf");

    expect(result.pageCount).toBe(2);

    expect(result.markdown).toContain("# RAG Guide");

    expect(result.markdown).toContain("## 第 1 页");

    expect(result.markdown).toContain("## 第 2 页");

    expect(result.markdown).toContain(
      "RAG retrieves relevant document chunks.",
    );

    expect(result.markdown).toContain(
      "The language model answers from retrieved evidence.",
    );

    expect(result.metadata).toMatchObject({
      inputType: "pdf",
      fileExtension: ".pdf",
      pageCount: 2,
    });
  });

  it("拒绝允许目录外的文件", async () => {
    const outsidePdf = join(outsideRoot, "outside.pdf");

    await createPdfFile(outsidePdf);

    const converter = await createConverter();

    await expect(converter.convert(outsidePdf)).rejects.toMatchObject({
      code: "PATH_OUTSIDE_ROOT",
    });
  });

  it("拒绝通过符号链接逃逸允许目录", async () => {
    const outsidePdf = join(outsideRoot, "outside.pdf");

    await createPdfFile(outsidePdf);

    const linkPath = join(allowedRoot, "linked.pdf");

    await symlink(outsidePdf, linkPath);

    const converter = await createConverter();

    await expect(converter.convert(linkPath)).rejects.toMatchObject({
      code: "PATH_OUTSIDE_ROOT",
    });
  });

  it("拒绝非 PDF 扩展名", async () => {
    const textPath = join(allowedRoot, "document.txt");

    await writeFile(textPath, "not a pdf", "utf8");

    const converter = await createConverter();

    await expect(converter.convert(textPath)).rejects.toMatchObject({
      code: "UNSUPPORTED_FILE_TYPE",
    });
  });

  it("拒绝伪造的 PDF 文件头", async () => {
    const fakePdfPath = join(allowedRoot, "fake.pdf");

    await writeFile(fakePdfPath, "this is not a pdf", "utf8");

    const converter = await createConverter();

    await expect(converter.convert(fakePdfPath)).rejects.toMatchObject({
      code: "INVALID_PDF_SIGNATURE",
    });
  });

  it("拒绝超过文件大小限制的 PDF", async () => {
    const pdfPath = join(allowedRoot, "large.pdf");

    await createPdfFile(pdfPath);

    const converter = await createConverter({
      maxFileBytes: 10,
    });

    await expect(converter.convert(pdfPath)).rejects.toMatchObject({
      code: "FILE_TOO_LARGE",
    });
  });

  it("拒绝超过页数限制的 PDF", async () => {
    const pdfPath = join(allowedRoot, "many-pages.pdf");

    await createPdfFile(pdfPath, {
      pageTexts: ["Page one", "Page two"],
    });

    const converter = await createConverter({
      maxPages: 1,
    });

    await expect(converter.convert(pdfPath)).rejects.toMatchObject({
      code: "PDF_TOO_MANY_PAGES",
    });
  });

  it("将没有可提取文字的 PDF 识别为空文本", async () => {
    const pdfPath = join(allowedRoot, "blank.pdf");

    await createPdfFile(pdfPath, {
      blank: true,
    });

    const converter = await createConverter({
      minExtractedCharacters: 1,
    });

    await expect(converter.convert(pdfPath)).rejects.toMatchObject({
      code: "PDF_TEXT_EMPTY",
    });
  });
});
