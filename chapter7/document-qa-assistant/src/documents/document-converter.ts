export interface ConvertedDocument {
  title: string;
  source: string;
  markdown: string;
  pageCount: number;
  metadata: Record<string, unknown>;
}

export interface DocumentConverter {
  convert(
    filePath: string,
  ): Promise<ConvertedDocument>;
}

export type DocumentConversionErrorCode =
  | "FILE_NOT_FOUND"
  | "PATH_OUTSIDE_ROOT"
  | "NOT_A_FILE"
  | "UNSUPPORTED_FILE_TYPE"
  | "FILE_TOO_LARGE"
  | "INVALID_PDF_SIGNATURE"
  | "PDF_ENCRYPTED"
  | "PDF_TOO_MANY_PAGES"
  | "PDF_TEXT_EMPTY"
  | "PDF_PARSE_FAILED";

export class DocumentConversionError extends Error {
  public constructor(
    public readonly code:
      DocumentConversionErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);

    this.name = "DocumentConversionError";
  }
}