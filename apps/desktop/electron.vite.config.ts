import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import fs from "fs";

const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, "package.json"), "utf-8"));

// Read VITE_GATEWAY_URL from web .env.local so main process can derive API URL (#110)
function readEnvFile(): Record<string, string> {
  const envPath = path.resolve(__dirname, "../web/.env.local");
  const vars: Record<string, string> = {};
  try {
    const content = fs.readFileSync(envPath, "utf-8");
    for (const line of content.split("\n")) {
      const match = line.match(/^(\w+)=(.*)$/);
      if (match) vars[match[1]] = match[2].trim();
    }
  } catch { /* no .env.local */ }
  return vars;
}
const envVars = readEnvFile();

// Derive API base URL for renderer (same logic as main process getApiBaseUrl).
// The API server scheme follows the gateway scheme — wss:// → https://, ws:// → http://
// — so a plain-HTTP gateway doesn't trigger TLS handshakes against an HTTP API.
function deriveApiUrl(): string {
  if (envVars.VITE_API_URL) return envVars.VITE_API_URL;
  const gwUrl = envVars.VITE_GATEWAY_URL;
  if (!gwUrl) return "";
  try {
    const u = new URL(gwUrl);
    const httpScheme = u.protocol === "wss:" ? "https" : "http";
    return `${httpScheme}://${u.hostname}:4001`;
  } catch {
    return "";
  }
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: ["@intelli-claw/shared"] })],
    build: {
      outDir: "out/main",
    },
    resolve: {
      alias: {
        "@intelli-claw/shared": path.resolve(__dirname, "../../packages/shared/src"),
      },
    },
    define: {
      // Inject gateway/API URLs into main process for API server fallback (#110)
      "process.env.VITE_GATEWAY_URL": JSON.stringify(envVars.VITE_GATEWAY_URL || ""),
      "process.env.VITE_API_URL": JSON.stringify(envVars.VITE_API_URL || ""),
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
    build: {
      outDir: path.resolve(__dirname, "out/renderer"),
      rollupOptions: {
        input: path.resolve(__dirname, "../web/src/index.html"),
      },
    },
    server: {
      port: 5174,
    },
    plugins: [react(), tailwindcss()],
    define: {
      "import.meta.env.VITE_APP_VERSION": JSON.stringify(pkg.version),
      // Inject API base URL so renderer fetch calls use the real API server
      // instead of relative /api/... which becomes file:///api/... in Electron (#110)
      "import.meta.env.VITE_API_URL": JSON.stringify(deriveApiUrl()),
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "../web/src"),
        "@intelli-claw/shared": path.resolve(__dirname, "../../packages/shared/src"),
      },
    },
  },
});
