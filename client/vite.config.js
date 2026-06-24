import { defineConfig } from "vite";
import legacy from "@vitejs/plugin-legacy";

// 后端地址（本地开发时前端代理到后端 3001）
const API_TARGET = process.env.API_TARGET || "http://127.0.0.1:3001";

export default defineConfig({
  plugins: [
    // 兼容老旧浏览器
    legacy({ targets: ["defaults", "not IE 11"] })
  ],
  server: {
    host: "127.0.0.1",
    proxy: {
      "/api": { target: API_TARGET, changeOrigin: true, ws: true },
      "/icons": { target: API_TARGET, changeOrigin: true },
      "/uploads": { target: API_TARGET, changeOrigin: true }
    }
  }
});
