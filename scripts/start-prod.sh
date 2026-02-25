#!/bin/bash
# intelli-claw Prod Server — Vite preview on port 4100
cd "$(dirname "$0")/.."

pkill -f "vite preview.*4100" 2>/dev/null
pkill -f "api-server" 2>/dev/null
sleep 1

echo "Building for production..."
pnpm build

# Start API server in background
nohup pnpm dev:server \
  > /tmp/intelli-claw-api.log 2>&1 &

echo "Starting prod preview server..."
nohup pnpm preview \
  > /tmp/intelli-claw-prod.log 2>&1 &
echo "Prod server starting on :4100 (log: /tmp/intelli-claw-prod.log)"

sleep 3
tail -3 /tmp/intelli-claw-prod.log
