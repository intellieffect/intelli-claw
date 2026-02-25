import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: "out/main",
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: "out/preload",
    },
  },
  renderer: {
    root: path.resolve(__dirname, "src/renderer"),
    publicDir: path.resolve(__dirname, "public"),
    build: {
      outDir: path.resolve(__dirname, "out/renderer"),
      rollupOptions: {
        input: path.resolve(__dirname, "src/renderer/index.html"),
      },
    },
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "src/renderer"),
      },
    },
  },
});
