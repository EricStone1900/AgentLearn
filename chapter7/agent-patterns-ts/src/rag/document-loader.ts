import { realpath, readFile } from "node:fs/promises";
import { basename, extname, relative, resolve, sep } from "node:path";
import type { LoadedRagDocument } from "./schemas.js";
import { createDocumentId, sha256 } from "./ids.js";

export interface LoadFileOptions {
  namespace: string;
  documentId?: string;
  metadata?: Record<string, unknown>;
}

export interface DocumentLoader {
  loadFile(filePath: string, options: LoadFileOptions): Promise<LoadedRagDocument>;
  loadText(
    text: string,
    source: string,
    options: LoadFileOptions,
  ): Promise<LoadedRagDocument>;
}

const supportedExtensions = new Set([".md", ".markdown", ".txt", ".json", ".csv"]);

function isInside(root: string, candidate: string): boolean {
  const pathFromRoot = relative(root, candidate);
  return pathFromRoot === "" ||
    (!pathFromRoot.startsWith(`..${sep}`) && pathFromRoot !== "..");
}

function normalizeJson(text: string): string {
  const value: unknown = JSON.parse(text);
  return `\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``;
}

export class LocalDocumentLoader implements DocumentLoader {
  private constructor(private readonly allowedRoot: string) {}

  public static async create(allowedRoot: string): Promise<LocalDocumentLoader> {
    return new LocalDocumentLoader(await realpath(resolve(allowedRoot)));
  }

  public async loadFile(
    filePath: string,
    options: LoadFileOptions,
  ): Promise<LoadedRagDocument> {
    const actualPath = await realpath(resolve(filePath));
    if (!isInside(this.allowedRoot, actualPath)) {
      throw new Error("文档路径超出 RAG_KNOWLEDGE_ROOT");
    }

    const extension = extname(actualPath).toLowerCase();
    if (!supportedExtensions.has(extension)) {
      throw new Error(`暂不支持文档格式：${extension || "无扩展名"}`);
    }

    const raw = await readFile(actualPath, "utf8");
    const markdown = extension === ".json" ? normalizeJson(raw) : raw;
    const source = relative(this.allowedRoot, actualPath);

    return this.createLoadedDocument(markdown, source, basename(actualPath), options, {
      fileExtension: extension,
    });
  }

  public async loadText(
    text: string,
    source: string,
    options: LoadFileOptions,
  ): Promise<LoadedRagDocument> {
    return this.createLoadedDocument(text, source, source, options, {
      inputType: "text",
    });
  }

  private createLoadedDocument(
    markdown: string,
    source: string,
    title: string,
    options: LoadFileOptions,
    loaderMetadata: Record<string, unknown>,
  ): LoadedRagDocument {
    const normalized = markdown.trim();
    if (!normalized) throw new Error("文档内容不能为空");
    const namespace = options.namespace.trim();
    if (!namespace) throw new Error("namespace 不能为空");

    return {
      id: options.documentId ?? createDocumentId(namespace, source),
      namespace,
      source,
      title,
      markdown: normalized,
      contentHash: sha256(normalized),
      metadata: {
        ...loaderMetadata,
        ...(options.metadata ?? {}),
      },
    };
  }
}