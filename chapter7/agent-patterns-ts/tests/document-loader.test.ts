import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocalDocumentLoader } from "../src/rag/document-loader.js";

describe("LocalDocumentLoader", () => {
  let root: string;
  let outsideRoot: string;
  let loader: LocalDocumentLoader;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "rag-loader-root-"));
    outsideRoot = await mkdtemp(join(tmpdir(), "rag-loader-outside-"));
    loader = await LocalDocumentLoader.create(root);
  });

  afterEach(async () => {
    await Promise.all([
      rm(root, { recursive: true, force: true }),
      rm(outsideRoot, { recursive: true, force: true }),
    ]);
  });

  it.each([
    ["guide.md", "# RAG\n\n向量检索"],
    ["note.markdown", "## 标题\n\n正文"],
    ["plain.txt", "普通文本"],
    ["table.csv", "name,value\nRAG,1"],
  ])("加载支持的文本格式：%s", async (fileName, content) => {
    const filePath = join(root, fileName);
    await writeFile(filePath, content, "utf8");

    const document = await loader.loadFile(filePath, {
      namespace: "docs",
      metadata: { owner: "test" },
    });

    expect(document.namespace).toBe("docs");
    expect(document.source).toBe(fileName);
    expect(document.markdown).toBe(content);
    expect(document.metadata).toMatchObject({ owner: "test" });
    expect(document.id).toMatch(/^[0-9a-f-]{36}$/u);
  });

  it("把 JSON 格式化成 Markdown 代码块", async () => {
    const filePath = join(root, "config.json");
    await writeFile(filePath, '{"enabled":true,"count":2}', "utf8");

    const document = await loader.loadFile(filePath, { namespace: "docs" });

    expect(document.markdown).toBe(
      '```json\n{\n  "enabled": true,\n  "count": 2\n}\n```',
    );
  });

  it("拒绝不支持的扩展名", async () => {
    const filePath = join(root, "archive.pdf");
    await writeFile(filePath, "fake pdf", "utf8");

    await expect(loader.loadFile(filePath, { namespace: "docs" }))
      .rejects.toThrow("暂不支持文档格式：.pdf");
  });

  it("拒绝知识库根目录之外的文件", async () => {
    const outsideFile = join(outsideRoot, "secret.md");
    await writeFile(outsideFile, "不应读取", "utf8");

    await expect(loader.loadFile(outsideFile, { namespace: "docs" }))
      .rejects.toThrow("文档路径超出 RAG_KNOWLEDGE_ROOT");
  });

  it("拒绝通过符号链接逃离知识库根目录", async () => {
    const outsideFile = join(outsideRoot, "secret.md");
    const linkPath = join(root, "linked-secret.md");
    await writeFile(outsideFile, "不应读取", "utf8");
    await symlink(outsideFile, linkPath);

    await expect(loader.loadFile(linkPath, { namespace: "docs" }))
      .rejects.toThrow("文档路径超出 RAG_KNOWLEDGE_ROOT");
  });

  it("相同 namespace 和 source 生成稳定文档 ID", async () => {
    const first = await loader.loadText("第一版", "manual.md", {
      namespace: "docs",
    });
    const second = await loader.loadText("第二版", "manual.md", {
      namespace: "docs",
    });

    expect(first.id).toBe(second.id);
    expect(first.contentHash).not.toBe(second.contentHash);
  });

  it("拒绝空内容和空 namespace", async () => {
    await expect(loader.loadText("   ", "empty.md", { namespace: "docs" }))
      .rejects.toThrow("文档内容不能为空");
    await expect(loader.loadText("正文", "guide.md", { namespace: "   " }))
      .rejects.toThrow("namespace 不能为空");
  });
});
