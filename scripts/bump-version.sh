#!/usr/bin/env bash
# bump-version.sh — Synchronize version across ALL monorepo packages
# Usage: ./scripts/bump-version.sh [patch|minor|major|<explicit-version>]
#
# Examples:
#   ./scripts/bump-version.sh patch    # 0.2.20 → 0.2.21
#   ./scripts/bump-version.sh minor    # 0.2.20 → 0.3.0
#   ./scripts/bump-version.sh major    # 0.2.20 → 1.0.0
#   ./scripts/bump-version.sh 1.5.0   # → 1.5.0

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ROOT_PKG="$ROOT_DIR/package.json"
DESKTOP_PKG="$ROOT_DIR/apps/desktop/package.json"
WEB_PKG="$ROOT_DIR/apps/web/package.json"
MOBILE_PKG="$ROOT_DIR/apps/mobile/package.json"
MOBILE_CONFIG="$ROOT_DIR/apps/mobile/app.config.ts"

# Current version
CURRENT=$(node -e "console.log(require('$ROOT_PKG').version)")

if [ -z "${1:-}" ]; then
  echo "Current version: $CURRENT"
  echo ""
  echo "Usage: $0 [patch|minor|major|<version>]"
  echo ""
  echo "  patch  → bump patch (0.2.20 → 0.2.21)"
  echo "  minor  → bump minor (0.2.20 → 0.3.0)"
  echo "  major  → bump major (0.2.20 → 1.0.0)"
  echo "  x.y.z  → set explicit version"
  exit 1
fi

BUMP_TYPE="$1"

# Calculate new version
case "$BUMP_TYPE" in
  patch|minor|major)
    IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT"
    case "$BUMP_TYPE" in
      patch) PATCH=$((PATCH + 1)) ;;
      minor) MINOR=$((MINOR + 1)); PATCH=0 ;;
      major) MAJOR=$((MAJOR + 1)); MINOR=0; PATCH=0 ;;
    esac
    NEW_VERSION="$MAJOR.$MINOR.$PATCH"
    ;;
  *)
    # Validate semver format
    if [[ ! "$BUMP_TYPE" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
      echo "Error: '$BUMP_TYPE' is not a valid semver (x.y.z)"
      exit 1
    fi
    NEW_VERSION="$BUMP_TYPE"
    ;;
esac

echo "Bumping version: $CURRENT → $NEW_VERSION"
echo ""

# Update all package.json files
for PKG_FILE in "$ROOT_PKG" "$DESKTOP_PKG" "$WEB_PKG" "$MOBILE_PKG"; do
  if [ -f "$PKG_FILE" ]; then
    node -e "
      const fs = require('fs');
      const pkg = JSON.parse(fs.readFileSync('$PKG_FILE', 'utf-8'));
      pkg.version = '$NEW_VERSION';
      fs.writeFileSync('$PKG_FILE', JSON.stringify(pkg, null, 2) + '\n');
    "
    echo "  ✓ $(basename $(dirname $PKG_FILE))/package.json → $NEW_VERSION"
  fi
done

# Update mobile app.config.ts (hardcoded version string)
if [ -f "$MOBILE_CONFIG" ]; then
  sed -i '' "s/version: \"[0-9]*\.[0-9]*\.[0-9]*\"/version: \"$NEW_VERSION\"/" "$MOBILE_CONFIG"
  echo "  ✓ mobile/app.config.ts → $NEW_VERSION"
fi

echo ""
echo "Version bumped to $NEW_VERSION"
echo ""
echo "Next steps:"
echo "  git add -A && git commit -m 'chore: bump version to $NEW_VERSION'"
echo "  git tag v$NEW_VERSION"
echo "  pnpm package    # build Electron .dmg"
