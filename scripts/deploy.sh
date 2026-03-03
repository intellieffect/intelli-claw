#!/usr/bin/env bash
# deploy.sh — Deploy iClaw.app to Mac Studio (local) and/or MacBook (remote)
# Usage: ./scripts/deploy.sh [local|macbook|all]
#
# Targets:
#   local   — ~/Applications/iclaw.app on Mac Studio (this machine)
#   macbook — ~/Applications/iclaw.app on MacBook Pro via Tailscale SSH
#   all     — both targets (default)

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

# ─── Config ───────────────────────────────────────────────────────────
APP_NAME="iClaw"
PROCESS_NAME="iClaw"
BUILD_APP="$ROOT_DIR/apps/desktop/release/mac-arm64/${APP_NAME}.app"
INSTALL_DIR="$HOME/Applications"
INSTALL_PATH="$INSTALL_DIR/iclaw.app"

REMOTE_HOST="brucechoes-macbook-pro"
REMOTE_INSTALL_DIR="~/Applications"
REMOTE_INSTALL_PATH="$REMOTE_INSTALL_DIR/iclaw.app"

TARGET="${1:-all}"

# ─── Helpers ──────────────────────────────────────────────────────────
info()  { echo "  ℹ️  $*"; }
ok()    { echo "  ✅ $*"; }
warn()  { echo "  ⚠️  $*"; }
fail()  { echo "  ❌ $*" >&2; exit 1; }

# ─── Build ────────────────────────────────────────────────────────────
info "Building Electron app (build + package)..."
pnpm build:electron
pnpm package
ok "Build + package complete"

VERSION=$(node -e "console.log(require('$ROOT_DIR/package.json').version)")

# ─── Version bump guard ──────────────────────────────────────────────
# Ensure version was bumped since last deploy (check git tag)
LAST_TAG=$(git describe --tags --abbrev=0 2>/dev/null || echo "")
if [ -n "$LAST_TAG" ]; then
  LAST_TAG_VERSION="${LAST_TAG#v}"
  if [ "$VERSION" = "$LAST_TAG_VERSION" ]; then
    # Check if there are new commits since the tag
    COMMITS_SINCE=$(git rev-list "$LAST_TAG"..HEAD --count 2>/dev/null || echo "0")
    if [ "$COMMITS_SINCE" -gt 0 ]; then
      warn "Version $VERSION has not been bumped since tag $LAST_TAG ($COMMITS_SINCE new commits)"
      echo ""
      read -p "  Auto-bump patch version? [Y/n] " REPLY
      REPLY="${REPLY:-Y}"
      if [[ "$REPLY" =~ ^[Yy]$ ]]; then
        bash "$ROOT_DIR/scripts/bump-version.sh" patch
        VERSION=$(node -e "console.log(require('$ROOT_DIR/package.json').version)")
        git add "$ROOT_DIR/package.json" "$ROOT_DIR/apps/desktop/package.json"
        git commit -m "chore: bump version to $VERSION"
        git tag "v$VERSION"
        ok "Auto-bumped to v$VERSION"
      else
        fail "Deploy aborted. Bump version first: pnpm version:bump"
      fi
    fi
  fi
fi

echo ""
echo "═══════════════════════════════════════════"
echo "  iClaw v$VERSION Deploy ($TARGET)"
echo "═══════════════════════════════════════════"
echo ""

# ─── Kill iClaw ───────────────────────────────────────────────────────
kill_local() {
  if pgrep -x "$PROCESS_NAME" > /dev/null 2>&1; then
    info "Killing local $PROCESS_NAME..."
    pkill -x "$PROCESS_NAME" 2>/dev/null || true
    sleep 1
    # Force kill if still running
    if pgrep -x "$PROCESS_NAME" > /dev/null 2>&1; then
      pkill -9 -x "$PROCESS_NAME" 2>/dev/null || true
      sleep 1
    fi
    ok "Local $PROCESS_NAME terminated"
  else
    info "Local $PROCESS_NAME not running"
  fi
}

kill_remote() {
  info "Checking remote $PROCESS_NAME on $REMOTE_HOST..."
  if ssh "$REMOTE_HOST" "pgrep -x '$PROCESS_NAME'" > /dev/null 2>&1; then
    info "Killing remote $PROCESS_NAME..."
    ssh "$REMOTE_HOST" "pkill -x '$PROCESS_NAME' 2>/dev/null || true; sleep 1; pkill -9 -x '$PROCESS_NAME' 2>/dev/null || true"
    ok "Remote $PROCESS_NAME terminated"
  else
    info "Remote $PROCESS_NAME not running"
  fi
}

# ─── Deploy Local ─────────────────────────────────────────────────────
deploy_local() {
  echo "── Deploy Local (Mac Studio) ──────────────"
  kill_local

  # Remove old app
  if [ -d "$INSTALL_PATH" ]; then
    info "Removing old $INSTALL_PATH..."
    rm -rf "$INSTALL_PATH"
  fi

  # Copy new app
  info "Copying new app to $INSTALL_PATH..."
  mkdir -p "$INSTALL_DIR"
  cp -R "$BUILD_APP" "$INSTALL_PATH"

  # Remove quarantine attribute
  xattr -rd com.apple.quarantine "$INSTALL_PATH" 2>/dev/null || true

  ok "Local deploy complete: $INSTALL_PATH"
  echo ""
}

# ─── Deploy MacBook ───────────────────────────────────────────────────
deploy_macbook() {
  echo "── Deploy Remote (MacBook Pro) ────────────"

  # Check SSH connectivity
  if ! ssh -o ConnectTimeout=5 "$REMOTE_HOST" "echo ok" > /dev/null 2>&1; then
    fail "Cannot reach $REMOTE_HOST via SSH. Is Tailscale connected?"
  fi

  kill_remote

  # Remove old app on remote
  info "Removing old app on $REMOTE_HOST..."
  ssh "$REMOTE_HOST" "rm -rf $REMOTE_INSTALL_PATH"

  # Transfer new app via rsync (faster for large .app bundles)
  info "Transferring $APP_NAME.app to $REMOTE_HOST..."
  rsync -az --delete \
    "$BUILD_APP/" \
    "$REMOTE_HOST:$REMOTE_INSTALL_PATH/"

  # Remove quarantine on remote
  ssh "$REMOTE_HOST" "xattr -rd com.apple.quarantine $REMOTE_INSTALL_PATH 2>/dev/null || true"

  ok "Remote deploy complete: $REMOTE_HOST:$REMOTE_INSTALL_PATH"
  echo ""
}

# ─── Launch (optional) ───────────────────────────────────────────────
launch_local() {
  info "Launching $APP_NAME locally..."
  open "$INSTALL_PATH" &
  ok "$APP_NAME launched"
}

launch_remote() {
  info "Launching $APP_NAME on $REMOTE_HOST..."
  ssh "$REMOTE_HOST" "open $REMOTE_INSTALL_PATH" &
  ok "$APP_NAME launched on $REMOTE_HOST"
}

# ─── Main ─────────────────────────────────────────────────────────────
case "$TARGET" in
  local)
    deploy_local
    launch_local
    ;;
  macbook)
    deploy_macbook
    launch_remote
    ;;
  all)
    deploy_local
    deploy_macbook
    launch_local
    launch_remote
    ;;
  *)
    fail "Unknown target: $TARGET (use: local, macbook, all)"
    ;;
esac

echo "═══════════════════════════════════════════"
echo "  ✅ Deploy complete! (v$VERSION → $TARGET)"
echo "═══════════════════════════════════════════"
echo ""
