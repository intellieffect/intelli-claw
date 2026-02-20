#!/bin/bash
# intelli-clawd Prod Server — port 4100, uses .next-prod (separate from dev .next)
cd "$(dirname "$0")/.."
pkill -f "next start.*4100" 2>/dev/null
sleep 1
echo "Building for production..."
NEXT_DIST_DIR=.next-prod pnpm build
echo "Starting prod server..."
NEXT_DIST_DIR=.next-prod nohup npx next start --port 4100 > /tmp/intelli-clawd-prod.log 2>&1 &
echo "Prod server starting on :4100 (log: /tmp/intelli-clawd-prod.log)"
sleep 3
tail -3 /tmp/intelli-clawd-prod.log
