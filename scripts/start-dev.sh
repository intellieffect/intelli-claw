#!/bin/bash
# intelli-claw Dev Server — Vite (port 4002) + API server (port 4003)
# External access via Tailscale Serve: :4000→:4002, :4001→:4003
cd "$(dirname "$0")/.."

export API_PORT=4003

# Kill any existing dev servers
pkill -f "vite.*intelli-claw" 2>/dev/null
pkill -f "tsx.*api-server" 2>/dev/null
sleep 1

# Start API server in background
nohup pnpm dev:server \
  > /tmp/intelli-claw-api.log 2>&1 &
echo "API server starting on :$API_PORT (log: /tmp/intelli-claw-api.log)"

# Start Vite dev server
nohup pnpm --filter @intelli-claw/web dev --port 4002 --strictPort \
  > /tmp/intelli-claw-dev.log 2>&1 &
echo "Dev server starting on :4002 (log: /tmp/intelli-claw-dev.log)"

sleep 3
tail -3 /tmp/intelli-claw-dev.log
