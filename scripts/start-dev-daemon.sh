#!/bin/bash
# intelli-claw Dev Daemon — launchd-compatible (foreground, manages child processes)
# Starts: API server (port 4001) + Vite dev server (port 4000)
# External access via Tailscale Serve:
#   - https://...ts.net:4000 → localhost:4000 (Vite)
#   - https://...ts.net:4001 → localhost:4001 (API)
set -euo pipefail

cd "$(dirname "$0")/.."
export PATH="/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin:$PATH"
export API_PORT=4001

# Cleanup on exit
cleanup() {
  echo "[daemon] shutting down..."
  kill $API_PID $VITE_PID 2>/dev/null || true
  wait
}
trap cleanup EXIT INT TERM

# Kill any stale processes
pkill -f "vite.*intelli-claw" 2>/dev/null || true
pkill -f "tsx.*api-server" 2>/dev/null || true
sleep 1

# Start API server
pnpm dev:server &
API_PID=$!
echo "[daemon] API server started (PID=$API_PID, port $API_PORT)"

# Wait for API server to be ready
sleep 2

# Start Vite dev server (port 4000, strictPort)
pnpm --filter @intelli-claw/web dev --port 4000 --strictPort &
VITE_PID=$!
echo "[daemon] Vite dev server started (PID=$VITE_PID, port 4000)"

# Wait for either child to exit (then launchd will restart us)
wait -n
echo "[daemon] a child process exited, shutting down..."
