#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
AICERY="${AICERY_ROOT:-$(dirname "$ROOT")/aicery}"

echo "== idepus drift check =="

if [[ ! -d "$AICERY" ]]; then
  echo "SKIP: Aicery repo not found at $AICERY"
  exit 0
fi

export USE_MOCK_PROVIDER="${USE_MOCK_PROVIDER:-true}"
export API_KEY="${API_KEY:-dev}"

"$ROOT/scripts/aicery-up.sh"

if command -v aicery >/dev/null 2>&1; then
  aicery drift check
  aicery replay last --mock-tools
elif [[ -x "$AICERY/.venv/bin/aicery" ]]; then
  "$AICERY/.venv/bin/aicery" drift check
  "$AICERY/.venv/bin/aicery" replay last --mock-tools
elif command -v python3 >/dev/null 2>&1 && [[ -f "$AICERY/pyproject.toml" ]]; then
  (cd "$AICERY" && python3 -m aicery drift check)
  (cd "$AICERY" && python3 -m aicery replay last --mock-tools)
else
  echo "SKIP: aicery CLI not available — smoke only"
  "$ROOT/scripts/aicery-smoke.sh"
fi

echo "== drift check complete =="
