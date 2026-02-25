#!/bin/bash
# intelli-claw Web Prod Server — port 4100 (background)
# Accessible via Tailscale: https://bignos-mac-studio.tail7d5991.ts.net:4100
cd "$(dirname "$0")/.."

pkill -f "vite preview.*vite.config.web" 2>/dev/null
sleep 1

echo "Building web for production..."
pnpm web:build

echo "Starting prod web server..."
nohup pnpm web:prod > /tmp/intelli-claw-web-prod.log 2>&1 &
echo "Web prod server starting on :4100 (log: /tmp/intelli-claw-web-prod.log)"
sleep 3
tail -5 /tmp/intelli-claw-web-prod.log
