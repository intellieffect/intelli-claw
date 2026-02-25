#!/bin/bash
# intelli-claw Web Dev Server — port 4000 (background)
# Accessible via Tailscale: https://bignos-mac-studio.tail7d5991.ts.net:4000
cd "$(dirname "$0")/.."

pkill -f "vite.*vite.config.web" 2>/dev/null
sleep 1

nohup pnpm web:dev > /tmp/intelli-claw-web-dev.log 2>&1 &
echo "Web dev server starting on :4000 (log: /tmp/intelli-claw-web-dev.log)"
sleep 3
tail -5 /tmp/intelli-claw-web-dev.log
