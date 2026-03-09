#!/usr/bin/env bash
# deploy-testflight.sh — Build & submit iOS app to TestFlight via EAS
# Usage: ./scripts/deploy-testflight.sh [--skip-build] [--build-only]
#
# Options:
#   --skip-build   Submit latest existing build (skip new build)
#   --build-only   Build only, don't submit to TestFlight
#   (default)      Build + submit

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
MOBILE_DIR="$ROOT_DIR/apps/mobile"

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

# Check EAS login
if ! eas whoami >/dev/null 2>&1; then
  fail "Not logged in to EAS. Run: eas login"
fi

EAS_USER=$(eas whoami 2>/dev/null)
VERSION=$(node -e "console.log(require('$MOBILE_DIR/package.json').version)")

echo ""
echo "═══════════════════════════════════════════"
echo "  📱 TestFlight Deploy (v$VERSION)"
echo "  EAS Account: $EAS_USER"
echo "═══════════════════════════════════════════"
echo ""

# ─── Check uncommitted changes ───────────────────────────────────────
if ! git diff --quiet -- "$MOBILE_DIR" "$ROOT_DIR/packages/shared"; then
  fail "Uncommitted changes in apps/mobile/ or packages/shared/. Commit first."
fi

cd "$MOBILE_DIR"

# ─── Build ───────────────────────────────────────────────────────────
if [ "$SKIP_BUILD" = false ]; then
  info "Starting iOS production build..."
  echo ""

  # Interactive mode for Apple credentials (2FA may be needed)
  eas build --platform ios --profile production

  ok "Build complete"
  echo ""
fi

# ─── Submit ──────────────────────────────────────────────────────────
if [ "$BUILD_ONLY" = false ]; then
  info "Submitting to TestFlight..."
  echo ""

  eas submit --platform ios --latest

  ok "Submitted to TestFlight"
  echo ""

  echo "═══════════════════════════════════════════"
  echo "  ✅ TestFlight deploy complete! (v$VERSION)"
  echo ""
  echo "  Apple이 바이너리 처리 후 (5~10분)"
  echo "  TestFlight 앱에서 설치 가능"
  echo ""
  echo "  ASC: https://appstoreconnect.apple.com/apps/6760249434/testflight/ios"
  echo "═══════════════════════════════════════════"
else
  echo "═══════════════════════════════════════════"
  echo "  ✅ Build complete! (v$VERSION)"
  echo "  Submit later: eas submit --platform ios --latest"
  echo "═══════════════════════════════════════════"
fi
echo ""
