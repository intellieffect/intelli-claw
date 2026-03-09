#!/usr/bin/env bash
# deploy-android.sh — Build & distribute Android app via Firebase App Distribution
# Usage: ./scripts/deploy-android.sh [--skip-build] [--build-only]
#
# Options:
#   --skip-build   Distribute latest existing build (skip new build)
#   --build-only   Build only, don't distribute
#   (default)      Build + distribute

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
MOBILE_DIR="$ROOT_DIR/apps/mobile"

# ─── Config ──────────────────────────────────────────────────────────
FIREBASE_APP_ID="1:444849032338:android:ac53593f93beed57a86a4b"
FIREBASE_PROJECT="intelliclaw"
TESTERS="bigno@intellieffect.com,dev@intellieffect.com"

# ─── Parse args ──────────────────────────────────────────────────────
SKIP_BUILD=false
BUILD_ONLY=false

for arg in "$@"; do
  case "$arg" in
    --skip-build) SKIP_BUILD=true ;;
    --build-only) BUILD_ONLY=true ;;
    *) echo "❌ Unknown option: $arg"; echo "Usage: $0 [--skip-build] [--build-only]"; exit 1 ;;
  esac
done

# ─── Helpers ─────────────────────────────────────────────────────────
info()  { echo "  ℹ️  $*"; }
ok()    { echo "  ✅ $*"; }
fail()  { echo "  ❌ $*" >&2; exit 1; }

# ─── Preflight ───────────────────────────────────────────────────────
command -v eas >/dev/null 2>&1 || fail "eas-cli not found. Install: pnpm add -g eas-cli"
command -v firebase >/dev/null 2>&1 || fail "firebase-tools not found. Install: npm i -g firebase-tools"

if ! eas whoami >/dev/null 2>&1; then
  fail "Not logged in to EAS. Run: eas login"
fi

EAS_USER=$(eas whoami 2>/dev/null)
VERSION=$(node -e "console.log(require('$MOBILE_DIR/package.json').version)")

echo ""
echo "═══════════════════════════════════════════"
echo "  🤖 Android Deploy (v$VERSION)"
echo "  EAS Account: $EAS_USER"
echo "  Firebase: $FIREBASE_PROJECT"
echo "═══════════════════════════════════════════"
echo ""

# ─── Check uncommitted changes ───────────────────────────────────────
if ! git diff --quiet -- "$MOBILE_DIR" "$ROOT_DIR/packages/shared"; then
  fail "Uncommitted changes in apps/mobile/ or packages/shared/. Commit first."
fi

cd "$MOBILE_DIR"

# ─── Build ───────────────────────────────────────────────────────────
APK_PATH=""

if [ "$SKIP_BUILD" = false ]; then
  info "Starting Android production build..."
  echo ""

  eas build --platform android --profile production

  ok "Build complete"
  echo ""
fi

# ─── Distribute ──────────────────────────────────────────────────────
if [ "$BUILD_ONLY" = false ]; then
  info "Downloading latest Android build..."

  # Download the latest APK from EAS (buildType: apk in eas.json)
  BUILD_URL=$(eas build:list --platform android --status finished --limit 1 --json --non-interactive 2>/dev/null | node -e "
    const data = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    console.log(data[0]?.artifacts?.applicationArchiveUrl || data[0]?.artifacts?.buildUrl || '');
  ")

  if [ -z "$BUILD_URL" ]; then
    fail "No finished Android build found. Run without --skip-build first."
  fi

  TMPDIR=$(mktemp -d)
  APK_PATH="$TMPDIR/app.apk"
  info "Downloading from EAS..."
  curl -sL "$BUILD_URL" -o "$APK_PATH"
  ok "Downloaded: $APK_PATH"

  info "Uploading to Firebase App Distribution..."
  echo ""

  firebase appdistribution:distribute "$APK_PATH" \
    --app "$FIREBASE_APP_ID" \
    --project "$FIREBASE_PROJECT" \
    --testers "$TESTERS" \
    --release-notes "v$VERSION ($(date +%Y-%m-%d))"

  # Cleanup
  rm -rf "$TMPDIR"

  ok "Distributed to Firebase App Distribution"
  echo ""

  echo "═══════════════════════════════════════════"
  echo "  ✅ Android deploy complete! (v$VERSION)"
  echo ""
  echo "  테스터: $TESTERS"
  echo "  Firebase: https://console.firebase.google.com/project/$FIREBASE_PROJECT/appdistribution"
  echo "═══════════════════════════════════════════"
else
  echo "═══════════════════════════════════════════"
  echo "  ✅ Build complete! (v$VERSION)"
  echo "  Distribute later: $0 --skip-build"
  echo "═══════════════════════════════════════════"
fi
echo ""
