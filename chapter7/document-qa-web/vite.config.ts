import react from "@vitejs/plugin-react";
import {
  defineConfig,
  loadEnv,
} from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "");

  const apiTarget =
    env.DEV_API_TARGET?.trim() ||
    "http://127.0.0.1:3000";

  return {
    plugins: [react()],

    server: {
      host: "127.0.0.1",
      port: 5173,
      strictPort: true,

      proxy: {
        "/api": {
          target: apiTarget,
          changeOrigin: true,
        },
      },
    },

    preview: {
      host: "127.0.0.1",
      port: 4173,
      strictPort: true,
    },
  };
});
