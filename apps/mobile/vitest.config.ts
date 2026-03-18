import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    exclude: ["node_modules/**"],
  },
  resolve: {
    alias: {
      "@intelli-claw/shared": path.resolve(__dirname, "../../packages/shared/src"),
    },
  },
});
