import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import fs from "fs";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@intelli-claw/shared": path.resolve(__dirname, "../../packages/shared/src"),
    },
  },
  server: {
    port: 4000,
    host: true,
    allowedHosts: process.env.ALLOWED_HOSTS?.split(",").map(h => h.trim()) || [],
    https: {
      key: fs.readFileSync(path.resolve(__dirname, "../../certificates/localhost-key.pem")),
      cert: fs.readFileSync(path.resolve(__dirname, "../../certificates/localhost.pem")),
    },
    hmr: {
      // HMR WebSocket은 localhost로 접속하도록 강제 (인증서가 localhost 전용)
      host: "localhost",
    },
    proxy: {
      "/api": {
        target: "http://localhost:4001",
        changeOrigin: true,
      },
    },
  },
  preview: {
    port: 4100,
    host: true,
    https: {
      key: fs.readFileSync(path.resolve(__dirname, "../../certificates/localhost-key.pem")),
      cert: fs.readFileSync(path.resolve(__dirname, "../../certificates/localhost.pem")),
    },
    proxy: {
      "/api": {
        target: "http://localhost:4001",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
  },
});
