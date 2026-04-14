#!/bin/bash
# Start Claude Code webchat — single command to run everything.
# 1. Claude Code session with webchat channel plugin (tmux)
# 2. Dev servers (Vite + API) if not already running
cd "$(dirname "$0")/.."

SESSION_NAME="claude-webchat"
WS_PORT="${WEBCHAT_PORT:-4003}"

# ── 1. Claude Code session ──
if tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
  echo "[webchat] Claude session already running"
else
  echo "[webchat] Starting Claude Code session..."
  tmux new-session -d -s "$SESSION_NAME" \
    "WEBCHAT_PORT=$WS_PORT claude --dangerously-load-development-channels server:webchat --dangerously-skip-permissions"

  # Auto-confirm development channel warning
  sleep 3
  tmux send-keys -t "$SESSION_NAME" Enter
  sleep 8
  echo "[webchat] Claude Code session ready"
fi

# ── 2. Dev servers ──
if lsof -ti :4000 > /dev/null 2>&1; then
  echo "[webchat] Vite already running on :4000"
else
  echo "[webchat] Starting dev servers..."
  bash scripts/start-dev.sh
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "  웹 UI:      https://localhost:4000/#/claude-code"
echo "  WebSocket:  ws://127.0.0.1:$WS_PORT"
echo ""
echo "  Claude 세션: tmux attach -t $SESSION_NAME"
echo "  전체 종료:   pnpm claude:webchat:stop"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
