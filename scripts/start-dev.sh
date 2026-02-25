#!/bin/bash
# intelli-claw Dev Server — Vite + API server on port 4000/4001
cd "$(dirname "$0")/.."

# Kill any existing dev servers
pkill -f "vite.*4000" 2>/dev/null
pkill -f "api-server" 2>/dev/null
sleep 1

# Start API server in background
nohup pnpm dev:server \
  > /tmp/intelli-claw-api.log 2>&1 &
echo "API server starting on :4001 (log: /tmp/intelli-claw-api.log)"

# Start Vite dev server
nohup pnpm dev \
  > /tmp/intelli-claw-dev.log 2>&1 &
echo "Dev server starting on :4000 (log: /tmp/intelli-claw-dev.log)"

sleep 3
tail -3 /tmp/intelli-claw-dev.log
