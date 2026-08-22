const DEFAULT_MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const DEFAULT_API_TIMEOUT_MS = 75_000;
const DEFAULT_UPLOAD_TIMEOUT_MS = 180_000;

function readPositiveInteger(
  value: string | undefined,
  fallback: number,
  name: string,
): number {
  if (value === undefined || !value.trim()) {
    return fallback;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${name} 必须是正整数`);
  }

  return parsed;
}

function readRequiredText(
  value: string | undefined,
  fallback: string,
): string {
  const normalized = value?.trim() || fallback;

  if (!normalized) {
    throw new Error("VITE_API_BASE_URL 不能为空");
  }

  return normalized;
}

export const clientConfig = {
  apiBaseUrl: readRequiredText(
    import.meta.env.VITE_API_BASE_URL,
    "/api",
  ),

  appTitle: import.meta.env.VITE_APP_TITLE?.trim() || "智能文档问答助手",

  maxUploadBytes: readPositiveInteger(
    import.meta.env.VITE_MAX_UPLOAD_BYTES,
    DEFAULT_MAX_UPLOAD_BYTES,
    "VITE_MAX_UPLOAD_BYTES",
  ),

  /*
   * 普通问答请求至少应略大于后端 LLM_TIMEOUT_MS（当前为 60 秒）。
   * 上传 PDF 还要经历解析、切分和向量化，因此单独使用更长的超时。
   */
  apiTimeoutMs: readPositiveInteger(
    import.meta.env.VITE_API_TIMEOUT_MS,
    DEFAULT_API_TIMEOUT_MS,
    "VITE_API_TIMEOUT_MS",
  ),

  uploadTimeoutMs: readPositiveInteger(
    import.meta.env.VITE_UPLOAD_TIMEOUT_MS,
    DEFAULT_UPLOAD_TIMEOUT_MS,
    "VITE_UPLOAD_TIMEOUT_MS",
  ),
} as const;
