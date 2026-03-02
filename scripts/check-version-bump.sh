#!/usr/bin/env bash
# check-version-bump.sh — Guard: ensure version was bumped since last tag
# Used by CI or manually before packaging

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

CURRENT=$(node -e "console.log(require('./package.json').version)")
LATEST_TAG=$(git describe --tags --abbrev=0 2>/dev/null || echo "none")

if [ "$LATEST_TAG" = "none" ]; then
  echo "✓ No previous tags found. Current version: $CURRENT"
  exit 0
fi

TAG_VERSION="${LATEST_TAG#v}"

if [ "$CURRENT" = "$TAG_VERSION" ]; then
  echo "❌ Version $CURRENT matches latest tag $LATEST_TAG"
  echo "   Run: ./scripts/bump-version.sh patch"
  echo "   Or:  ./scripts/release.sh patch"
  exit 1
fi

echo "✓ Version bumped: $TAG_VERSION → $CURRENT"
