import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import fs from "fs";

const desktopPkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../apps/desktop/package.json"), "utf-8"));

const certKeyPath = path.resolve(__dirname, "../../certificates/localhost-key.pem");
const certPath = path.resolve(__dirname, "../../certificates/localhost.pem");
const hasCerts = fs.existsSync(certKeyPath) && fs.existsSync(certPath);
const httpsConfig = hasCerts
  ? { key: fs.readFileSync(certKeyPath), cert: fs.readFileSync(certPath) }
  : undefined;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    "import.meta.env.VITE_APP_VERSION": JSON.stringify(desktopPkg.version),
  },
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
    https: httpsConfig,
    hmr: {
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
    https: httpsConfig,
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
