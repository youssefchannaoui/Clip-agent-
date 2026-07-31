#!/usr/bin/env bash
set -euo pipefail

ROOT="${1:-.}"
PKG_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

cd "$ROOT"
test -f package.json || { echo "Run this against the Clip-agent repository root."; exit 1; }
test -f src/server.js || { echo "src/server.js was not found."; exit 1; }

cp "$PKG_DIR/src/public/workspace-shell.css" src/public/workspace-shell.css
cp "$PKG_DIR/src/public/workspace-shell.js" src/public/workspace-shell.js
cp "$PKG_DIR/src/public/activity-fix.js" src/public/activity-fix.js
git apply "$PKG_DIR/server-workspace-shell.patch"

echo "Files installed."
echo "Run: npm run check && npm test"
