import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import fs from "fs";

const pkg = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "package.json"), "utf-8"),
);

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
    root: path.resolve(__dirname, "../web/src"),
    envDir: path.resolve(__dirname, "../web"),
    publicDir: path.resolve(__dirname, "../../public"),
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "../web/src"),
        "@intelli-claw/shared": path.resolve(__dirname, "../../packages/shared/src"),
      },
    },
    build: {
      outDir: path.resolve(__dirname, "out/renderer"),
      rollupOptions: {
        input: path.resolve(__dirname, "../web/src/index.html"),
        output: {
          manualChunks: {
            "react-vendor": ["react", "react-dom"],
            markdown: [
              "react-markdown",
              "remark-gfm",
              "remark-breaks",
              "rehype-highlight",
            ],
          },
        },
      },
      chunkSizeWarningLimit: 1200,
    },
    plugins: [react(), tailwindcss()],
    define: {
      "import.meta.env.VITE_APP_VERSION": JSON.stringify(pkg.version),
    },
  },
});
