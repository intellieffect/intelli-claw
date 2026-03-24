// pm2 ecosystem config — intelli-claw background services
// Usage:
//   pm2 start ecosystem.config.cjs          # 전체 시작
//   pm2 start ecosystem.config.cjs --only iclaw-web-dev   # 개별 시작
//   pm2 logs                                # 로그 보기
//   pm2 status                              # 상태 확인
//   pm2 restart all                         # 전체 재시작
//   pm2 stop all && pm2 delete all          # 전체 종료

// Load .env.local (no external deps)
const fs = require("fs");
const path = require("path");
const envPath = path.join(__dirname, ".env.local");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
}

const PROJECT_ROOT = process.env.PROJECT_ROOT || __dirname;
const MOBILE_ROOT = `${PROJECT_ROOT}/apps/mobile`;

const TAILSCALE_FQDN = process.env.TAILSCALE_FQDN || "localhost";
const ALLOWED_HOSTS = process.env.ALLOWED_HOSTS || TAILSCALE_FQDN;

module.exports = {
  apps: [
    // ── Web Dev (port 4000) + API (port 4001) ──
    {
      name: "iclaw-api-dev",
      cwd: PROJECT_ROOT,
      script: "pnpm",
      args: "dev:server",
      interpreter: "none",
      env: {
        API_PORT: "4001",
      },
      autorestart: true,
      max_restarts: 10,
    },
    {
      name: "iclaw-web-dev",
      cwd: PROJECT_ROOT,
      script: "pnpm",
      args: "--filter @intelli-claw/web dev --port 4000 --strictPort",
      interpreter: "none",
      env: {
        API_PORT: "4001",
        ALLOWED_HOSTS,
      },
      autorestart: true,
      max_restarts: 10,
      // API 서버가 먼저 뜨도록 2초 대기
      restart_delay: 2000,
    },

    // ── Web Prod (port 4100) + API (port 4003) ──
    // 주의: 시작 전 `pnpm build` 필요
    {
      name: "iclaw-api-prod",
      cwd: PROJECT_ROOT,
      script: "pnpm",
      args: "dev:server",
      interpreter: "none",
      env: {
        API_PORT: "4003",
      },
      autorestart: true,
      max_restarts: 10,
    },
    {
      name: "iclaw-web-prod",
      cwd: PROJECT_ROOT,
      script: "pnpm",
      args: "--filter @intelli-claw/web preview --port 4100 --strictPort",
      interpreter: "none",
      env: {
        API_PORT: "4003",
        ALLOWED_HOSTS,
      },
      autorestart: true,
      max_restarts: 10,
      restart_delay: 2000,
    },

    // ── Mobile (Expo dev server) ──
    {
      name: "iclaw-mobile",
      cwd: MOBILE_ROOT,
      script: "npx",
      args: "expo start --non-interactive --port 8082",
      interpreter: "none",
      env: {
        GATEWAY_URL: `wss://${TAILSCALE_FQDN}`,
        GATEWAY_TOKEN: process.env.VITE_GATEWAY_TOKEN || "",
        GATEWAY_HTTP_URL: `https://${TAILSCALE_FQDN}`,
      },
      autorestart: true,
      max_restarts: 10,
    },
  ],
};
