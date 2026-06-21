#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN_DIR="$ROOT/src-tauri/binaries"
TARGET="${1:-$(rustc -vV | awk '/^host: / { print $2 }')}"

mkdir -p "$BIN_DIR"
cp "$ROOT/scripts/aicery-sidecar-stub.sh" "$BIN_DIR/aicery-$TARGET"
chmod +x "$BIN_DIR/aicery-$TARGET"
echo "Built stub sidecar: $BIN_DIR/aicery-$TARGET"
