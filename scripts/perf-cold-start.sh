#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN="${1:-$ROOT/src-tauri/target/release/idepus}"

if [[ ! -x "$BIN" ]]; then
  echo "Build release binary first: cargo build --release -p idepus"
  exit 1
fi

START=$(date +%s%3N)
"$BIN" --version >/dev/null 2>&1 || true
END=$(date +%s%3N)
echo "cold_start_ms=$((END - START))"
