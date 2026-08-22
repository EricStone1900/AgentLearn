import { rm } from "node:fs/promises";

const distDirectory = new URL("../dist/", import.meta.url);

await rm(distDirectory, {
  recursive: true,
  force: true,
});

console.log("已清理 dist 目录");