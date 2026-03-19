#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INSTALL_DIR="${DUDE_MAC_INSTALL_DIR:-$HOME/Applications/Dude Accounting}"
BACKUP_DIR="${DUDE_MAC_BACKUP_DIR:-$HOME/DudeAccountingData/Backups}"
EXPORT_DIR="${DUDE_MAC_EXPORT_DIR:-$HOME/DudeAccountingData/Exports}"
RELEASE_DIR="${DUDE_MAC_RELEASE_OUTPUT:-$HOME/DudeAccountingBuild/release}"

mkdir -p "$INSTALL_DIR" "$BACKUP_DIR" "$EXPORT_DIR" "$RELEASE_DIR"

echo "Prepared macOS install and release directories:"
echo " - repo: $REPO_ROOT"
echo " - install: $INSTALL_DIR"
echo " - backups: $BACKUP_DIR"
echo " - exports: $EXPORT_DIR"
echo " - release: $RELEASE_DIR"

if command -v xcode-select >/dev/null 2>&1; then
  if xcode-select -p >/dev/null 2>&1; then
    echo " - Xcode Command Line Tools: OK"
  else
    echo " - Xcode Command Line Tools: missing"
    echo "Run: xcode-select --install"
  fi
else
  echo " - xcode-select: not found"
  echo "Run on macOS and install Xcode Command Line Tools first."
fi

if command -v npm >/dev/null 2>&1; then
  echo " - npm: OK"
else
  echo " - npm: not found"
fi
