import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const agentOrigin =
    env.VITE_EVE_AGENT_ORIGIN?.trim() ||
    process.env.VITE_EVE_AGENT_ORIGIN?.trim() ||
    "http://127.0.0.1:2000";

  return {
    plugins: [react()],
    server: {
      host: "127.0.0.1",
      port: 5173,
      proxy: {
        "/eve/v1": {
          target: agentOrigin,
          changeOrigin: true,
        },
      },
    },
    build: {
      outDir: "dist",
    },
  };
});
