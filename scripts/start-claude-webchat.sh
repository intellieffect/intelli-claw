#!/bin/bash
# Start Claude Code webchat — single command to run everything.
# Resumes previous session if available.
cd "$(dirname "$0")/.."

SESSION_NAME="claude-webchat"
WS_PORT="${WEBCHAT_PORT:-4003}"
SESSION_FILE="$HOME/.claude/webchat-session.json"

# ── Read previous session ID ──
RESUME_FLAG=""
if [ -f "$SESSION_FILE" ]; then
  PREV_SESSION=$(python3 -c "import json; print(json.load(open('$SESSION_FILE')).get('sessionId',''))" 2>/dev/null)
  if [ -n "$PREV_SESSION" ]; then
    RESUME_FLAG="--resume $PREV_SESSION"
    echo "[webchat] Resuming session: $PREV_SESSION"
  fi
fi

# ── 1. Claude Code session ──
if tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
  echo "[webchat] Claude session already running"
else
  echo "[webchat] Starting Claude Code session..."
  tmux new-session -d -s "$SESSION_NAME" \
    "WEBCHAT_PORT=$WS_PORT claude --dangerously-load-development-channels server:webchat --dangerously-skip-permissions $RESUME_FLAG"

  # Auto-confirm development channel warning
  sleep 3
  tmux send-keys -t "$SESSION_NAME" Enter
  sleep 8

  # Capture session ID from Claude's session files
  CLAUDE_PID=$(tmux list-panes -t "$SESSION_NAME" -F '#{pane_pid}' 2>/dev/null | head -1)
  if [ -n "$CLAUDE_PID" ]; then
    # Find the actual claude process (child of the shell)
    REAL_PID=$(pgrep -P "$CLAUDE_PID" -f "claude" 2>/dev/null | head -1)
    [ -z "$REAL_PID" ] && REAL_PID="$CLAUDE_PID"
    SESSION_JSON="$HOME/.claude/sessions/$REAL_PID.json"
    if [ -f "$SESSION_JSON" ]; then
      NEW_SESSION=$(python3 -c "import json; print(json.load(open('$SESSION_JSON')).get('sessionId',''))" 2>/dev/null)
      if [ -n "$NEW_SESSION" ]; then
        echo "{\"sessionId\":\"$NEW_SESSION\"}" > "$SESSION_FILE"
        echo "[webchat] Session ID saved: $NEW_SESSION"
      fi
    fi
  fi

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
