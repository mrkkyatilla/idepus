#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
AICERY="${AICERY_ROOT:-$(dirname "$ROOT")/aicery}"
OVERRIDE="$ROOT/deploy/aicery.compose.override.yml"
PROVIDER_ENV="${XDG_CONFIG_HOME:-$HOME/.config}/idepus/aicery-provider.env"

if [[ -f "$PROVIDER_ENV" ]]; then
  set -a
  # shellcheck source=/dev/null
  source "$PROVIDER_ENV"
  set +a
fi

if [[ -n "${OPENAI_API_KEY:-}" || -n "${ANTHROPIC_API_KEY:-}" || -n "${GEMINI_API_KEY:-}" ]]; then
  export USE_MOCK_PROVIDER=false
fi

COMPOSE=(docker compose -f "$AICERY/deploy/docker-compose.yml" -f "$OVERRIDE")

cd "$AICERY/deploy"
"${COMPOSE[@]}" up -d --wait api --remove-orphans
echo "OK: Aicery API reloaded with provider env"
