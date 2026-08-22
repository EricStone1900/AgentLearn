import "dotenv/config";
import { resolve } from "node:path";
import { loadAppConfig } from "../config/app-config.js";
import { PdfDocumentConverter } from "../documents/index.js";

const filePath = process.argv[2];

if (!filePath) {
  console.error(
    [
      "缺少 PDF 文件路径。",
      "用法：",
      "npm run verify:pdf -- ./uploads/example.pdf",
    ].join("\n"),
  );

  process.exitCode = 1;
} else {
  try {
    const config = loadAppConfig();

    const converter = await PdfDocumentConverter.create({
      allowedRoot: config.files.uploadRoot,

      maxFileBytes: config.files.maxUploadBytes,

      maxPages: config.files.maxPdfPages,

      minExtractedCharacters: config.files.minPdfTextCharacters,
    });

    const result = await converter.convert(resolve(filePath));

    console.log(
      JSON.stringify(
        {
          success: true,
          title: result.title,
          source: result.source,
          pageCount: result.pageCount,

          markdownCharacters: result.markdown.length,

          metadata: result.metadata,

          preview: result.markdown.slice(0, 500),
        },
        null,
        2,
      ),
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);

    const code =
      error && typeof error === "object" && "code" in error
        ? error.code
        : "UNKNOWN_ERROR";

    console.error(
      JSON.stringify(
        {
          success: false,
          code,
          message,
        },
        null,
        2,
      ),
    );

    process.exitCode = 1;
  }
}
