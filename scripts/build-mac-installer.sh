#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This script must be run on macOS."
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RELEASE_DIR="${DUDE_MAC_RELEASE_OUTPUT:-$HOME/DudeAccountingBuild/release}"

cd "$REPO_ROOT"
mkdir -p "$RELEASE_DIR"

echo "Repository: $REPO_ROOT"
echo "macOS installer output: $RELEASE_DIR"

find "$RELEASE_DIR" -maxdepth 1 -type f \
  \( -name '*.dmg' -o -name '*.zip' -o -name '*.blockmap' -o -name 'latest*.yml' -o -name 'builder-debug.yml' \) \
  -delete
find "$RELEASE_DIR" -maxdepth 1 -type d \
  \( -name 'mac*' -o -name '*-unpacked' \) \
  -exec rm -rf {} +

npm run build
npx electron-builder --mac dmg zip --publish never -c.directories.output="$RELEASE_DIR"

DMG_FILE="$(find "$RELEASE_DIR" -maxdepth 1 -type f -name '*.dmg' | sort | tail -n 1 || true)"
if [[ -z "$DMG_FILE" ]]; then
  echo "macOS installer was not generated."
  exit 1
fi

echo "macOS installer build completed: $DMG_FILE"
