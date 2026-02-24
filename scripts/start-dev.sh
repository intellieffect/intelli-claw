#!/bin/bash
# intelli-clawd Dev Server — port 4000
cd "$(dirname "$0")/.."
pkill -f "next dev.*4000" 2>/dev/null
sleep 1
rm -rf .next
nohup pnpm dev --port 4000 --hostname 0.0.0.0 \
  --experimental-https \
  --experimental-https-key certificates/localhost-key.pem \
  --experimental-https-cert certificates/localhost.pem \
  > /tmp/intelli-clawd-dev.log 2>&1 &
echo "Dev server starting on :4000 (log: /tmp/intelli-clawd-dev.log)"
sleep 3
tail -3 /tmp/intelli-clawd-dev.log
