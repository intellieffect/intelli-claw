import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import fs from "fs";

const desktopPkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../apps/desktop/package.json"), "utf-8"));

const certKeyPath = path.resolve(__dirname, "../../certificates/localhost-key.pem");
const certPath = path.resolve(__dirname, "../../certificates/localhost.pem");
const disableHttps = process.env.VITE_DISABLE_HTTPS === "1";
const hasCerts = !disableHttps && fs.existsSync(certKeyPath) && fs.existsSync(certPath);
const httpsConfig = hasCerts
  ? { key: fs.readFileSync(certKeyPath), cert: fs.readFileSync(certPath) }
  : undefined;

const apiPort = process.env.API_PORT || "4001";
const apiTarget = `http://localhost:${apiPort}`;

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
    host: "127.0.0.1",
    allowedHosts: [
      "localhost",
      "brucechoe-macstudio.tailcc76d6.ts.net",
      ...(process.env.ALLOWED_HOSTS?.split(",").map(h => h.trim()) || []),
    ],
    https: httpsConfig,
    hmr: {
      host: "localhost",
    },
    proxy: {
      "/api": {
        target: apiTarget,
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
        target: apiTarget,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
  },
});
