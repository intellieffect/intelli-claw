#!/bin/bash
# Claude Code Remote Control — tmux 세션에서 실행
# 브라우저(claude.ai/code)에서 웹챗으로 접속 가능
cd "$(dirname "$0")/.."

SESSION_NAME="claude-rc"
RC_NAME="${1:-intelli-claw}"

# 이미 실행 중인지 확인
if tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
  echo "Claude RC session already running."
  echo ""
  echo "  접속:  tmux attach -t $SESSION_NAME"
  echo "  종료:  tmux kill-session -t $SESSION_NAME"
  echo "  웹:   claude.ai/code 에서 초록색 세션 선택"
  echo ""
  exit 0
fi

echo "Starting Claude Code Remote Control..."
echo ""
echo "  세션명:  $RC_NAME"
echo "  tmux:   $SESSION_NAME"
echo ""

# tmux 세션 생성 + remote-control 실행
tmux new-session -d -s "$SESSION_NAME" \
  "cd $(pwd) && claude remote-control --name \"$RC_NAME\""

sleep 2

echo "Claude RC started in tmux session '$SESSION_NAME'"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "  1. URL/QR 확인:   tmux attach -t $SESSION_NAME"
echo "  2. 웹에서 접속:   claude.ai/code → 세션 목록에서 '$RC_NAME' 선택"
echo "  3. 종료:          tmux kill-session -t $SESSION_NAME"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
