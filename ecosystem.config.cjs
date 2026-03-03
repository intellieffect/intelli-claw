// pm2 ecosystem config — intelli-claw background services
// Usage:
//   pm2 start ecosystem.config.cjs          # 전체 시작
//   pm2 start ecosystem.config.cjs --only iclaw-web-dev   # 개별 시작
//   pm2 logs                                # 로그 보기
//   pm2 status                              # 상태 확인
//   pm2 restart all                         # 전체 재시작
//   pm2 stop all && pm2 delete all          # 전체 종료

const PROJECT_ROOT = "/Volumes/BIGNO-FC2T/Projects/intelli-claw";
const MOBILE_ROOT = `${PROJECT_ROOT}/apps/mobile`;

const TAILSCALE_FQDN = "bignos-mac-studio.tail7d5991.ts.net";

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
        ALLOWED_HOSTS: `bignos-mac-studio,${TAILSCALE_FQDN}`,
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
        ALLOWED_HOSTS: `bignos-mac-studio,${TAILSCALE_FQDN}`,
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
        GATEWAY_TOKEN: "REDACTED_TOKEN",
        GATEWAY_HTTP_URL: `https://${TAILSCALE_FQDN}`,
      },
      autorestart: true,
      max_restarts: 10,
    },
  ],
};
