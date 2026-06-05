import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      // 开发时把 /api 代理到后端，避免 CORS 与硬编码地址
      "/api": "http://localhost:5174",
    },
  },
});
