/**
 * Standalone Vite config for serving the renderer as a web app.
 * Used by `pnpm web:dev` and `pnpm web:prod` — runs independently of Electron.
 */
import { resolve } from "path";
import { readFileSync, existsSync } from "fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/postcss";

const certKeyPath = resolve(__dirname, "certificates/localhost-key.pem");
const certPath = resolve(__dirname, "certificates/localhost.pem");
const hasCerts = existsSync(certKeyPath) && existsSync(certPath);
const httpsOptions = hasCerts
  ? { key: readFileSync(certKeyPath), cert: readFileSync(certPath) }
  : undefined;

export default defineConfig({
  root: resolve(__dirname, "src/renderer"),
  build: {
    outDir: resolve(__dirname, "out/web"),
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(__dirname, "src/renderer/index.html"),
    },
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "src/renderer"),
      "@/lib": resolve(__dirname, "src/renderer/lib"),
      "@/components": resolve(__dirname, "src/renderer/components"),
    },
  },
  plugins: [react()],
  css: {
    postcss: {
      plugins: [tailwindcss()],
    },
  },
  server: {
    host: "0.0.0.0",
    port: 4000,
    https: httpsOptions,
    allowedHosts: ["bignos-mac-studio.tail7d5991.ts.net"],
  },
  preview: {
    host: "0.0.0.0",
    port: 4100,
    https: httpsOptions,
    allowedHosts: ["bignos-mac-studio.tail7d5991.ts.net"],
  },
});
