/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string;
  readonly VITE_APP_TITLE?: string;
  readonly VITE_MAX_UPLOAD_BYTES?: string;
  readonly VITE_API_TIMEOUT_MS?: string;
  readonly VITE_UPLOAD_TIMEOUT_MS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
