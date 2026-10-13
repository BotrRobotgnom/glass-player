#!/usr/bin/env bash
# Linux build (AppImage). Run: ./build.sh
set -euo pipefail
cd "$(dirname "$0")"

command -v node >/dev/null || { echo "Node.js 20+ is required"; exit 1; }
[ -d node_modules ] || npm install

rm -rf dist
npm run dist:linux

echo
echo "Done. Files in dist:"
ls -1 dist | grep -E '\.AppImage$|latest-linux\.yml$' || true
