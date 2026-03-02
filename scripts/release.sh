#!/usr/bin/env bash
# release.sh — Full release flow: bump → build → package → tag → push
# Usage: ./scripts/release.sh [patch|minor|major|<version>]
#
# This script enforces that every release has a unique version.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

# --- Preflight checks ---

# Ensure working tree is clean (allow untracked files)
if ! git diff --quiet HEAD 2>/dev/null; then
  echo "❌ Working tree has uncommitted changes. Commit or stash first."
  exit 1
fi

BUMP_TYPE="${1:-}"
if [ -z "$BUMP_TYPE" ]; then
  CURRENT=$(node -e "console.log(require('./package.json').version)")
  echo "Current version: $CURRENT"
  echo ""
  echo "Usage: $0 [patch|minor|major|<version>]"
  exit 1
fi

# --- 1. Bump version ---
echo "═══════════════════════════════════════════"
echo "  Step 1/5: Bump version ($BUMP_TYPE)"
echo "═══════════════════════════════════════════"
bash scripts/bump-version.sh "$BUMP_TYPE"

NEW_VERSION=$(node -e "console.log(require('./package.json').version)")
echo ""

# --- 2. Commit version bump ---
echo "═══════════════════════════════════════════"
echo "  Step 2/5: Commit version bump"
echo "═══════════════════════════════════════════"
git add package.json apps/desktop/package.json
git commit -m "chore: bump version to $NEW_VERSION"
echo "  ✓ Committed"
echo ""

# --- 3. Build ---
echo "═══════════════════════════════════════════"
echo "  Step 3/5: Build Electron app"
echo "═══════════════════════════════════════════"
pnpm build:electron
echo "  ✓ Build complete"
echo ""

# --- 4. Package ---
echo "═══════════════════════════════════════════"
echo "  Step 4/5: Package (.dmg)"
echo "═══════════════════════════════════════════"
pnpm package
echo "  ✓ Package complete"
echo ""

# --- 5. Tag & Push ---
echo "═══════════════════════════════════════════"
echo "  Step 5/5: Tag & Push"
echo "═══════════════════════════════════════════"
git tag "v$NEW_VERSION"
echo "  ✓ Tagged v$NEW_VERSION"

echo ""
echo "Push with:"
echo "  git push && git push --tags"
echo ""

# Show the artifact
DMG_PATH=$(find apps/desktop/release -name "*.dmg" -newer package.json 2>/dev/null | head -1)
if [ -n "$DMG_PATH" ]; then
  echo "📦 Artifact: $DMG_PATH"
  echo "   Size: $(du -h "$DMG_PATH" | cut -f1)"
fi

echo ""
echo "✅ Release v$NEW_VERSION ready!"
echo ""
echo "Deploy with:"
echo "  pnpm deploy:all      # Mac Studio + MacBook"
echo "  pnpm deploy:local    # Mac Studio only"
echo "  pnpm deploy:macbook  # MacBook only"
