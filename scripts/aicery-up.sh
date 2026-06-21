#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
AICERY="${AICERY_ROOT:-$(dirname "$ROOT")/aicery}"
OVERRIDE="$ROOT/deploy/aicery.compose.override.yml"

if [[ ! -d "$AICERY/deploy" ]]; then
  echo "Aicery not found at: $AICERY"
  echo "Clone it beside idepus or set AICERY_ROOT=/path/to/aicery"
  exit 1
fi

if [[ ! -d "$ROOT/idepus-plugin" ]]; then
  echo "Missing plugin dir: $ROOT/idepus-plugin"
  exit 1
fi

export IDEPUS_PLUGIN_PATH="$ROOT/idepus-plugin"
export PLUGIN_PATHS=/idepus-plugin

PROVIDER_ENV="${XDG_CONFIG_HOME:-$HOME/.config}/idepus/aicery-provider.env"
if [[ -f "$PROVIDER_ENV" ]]; then
  set -a
  # shellcheck source=/dev/null
  source "$PROVIDER_ENV"
  set +a
  echo "Loaded provider keys from $PROVIDER_ENV"
fi

if [[ -n "${OPENAI_API_KEY:-}" || -n "${ANTHROPIC_API_KEY:-}" || -n "${GEMINI_API_KEY:-}" ]]; then
  export USE_MOCK_PROVIDER=false
else
  export USE_MOCK_PROVIDER="${USE_MOCK_PROVIDER:-true}"
fi
export HITL_ENABLED="${HITL_ENABLED:-true}"
export API_KEY="${API_KEY:-dev}"
export IDEPUS_BRIDGE_TOKEN="${IDEPUS_BRIDGE_TOKEN:-idepus-dev-bridge}"

COMPOSE=(docker compose -f "$AICERY/deploy/docker-compose.yml" -f "$OVERRIDE")

echo "== Starting Aicery for idepus =="
echo "Aicery:  $AICERY"
echo "Plugin:  $IDEPUS_PLUGIN_PATH -> /idepus-plugin"

cd "$AICERY/deploy"
"${COMPOSE[@]}" up -d --wait postgres redis nats qdrant --remove-orphans
"${COMPOSE[@]}" run --rm --build migrate
"${COMPOSE[@]}" up -d --build --force-recreate --wait api --remove-orphans

curl -sf http://localhost:8000/health | grep -q '"status":"ok"'
echo "OK: Aicery health"

AGENTS="$(curl -sf http://localhost:8000/v1/agents -H "X-API-Key: $API_KEY")"
echo "Agents: $AGENTS"

for required in code-editor code-explorer explore-planner lint-fix multi-file-editor; do
  if ! echo "$AGENTS" | grep -q "\"id\":\"$required\""; then
    echo "FAIL: agent $required not listed — check PLUGIN_PATHS mount"
    exit 1
  fi
done
echo "OK: idepus agents listed"

# YAML manifests appear immediately; graph builders load only at API startup.
# Verify explore-planner graph is registered (not just the manifest).
python3 - <<'PY'
import json
import os
import time
import urllib.error
import urllib.request

base = "http://localhost:8000"
key = os.environ.get("API_KEY", "dev")

def api(method: str, path: str, body: dict | None = None) -> dict:
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(
        f"{base}{path}",
        data=data,
        headers={"X-API-Key": key, "Content-Type": "application/json"},
        method=method,
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read().decode())

run = api("POST", "/v1/runs", {
    "agent_id": "explore-planner",
    "input": "smoke: plan a tiny refactor",
    "execute": True,
})
run_id = run["id"]
for _ in range(30):
    final = api("GET", f"/v1/runs/{run_id}")
    status = final.get("status")
    if status not in ("pending", "running"):
        code = final.get("error_code")
        if code == "UNKNOWN_AGENT":
            raise SystemExit(
                "FAIL: explore-planner graph not loaded — rerun ./scripts/aicery-up.sh "
                "(API must restart after idepus-plugin/agents/graph.py changes)"
            )
        if status == "failed" and code not in (None, "RUN_FAILED"):
            raise SystemExit(f"FAIL: explore-planner run failed: {code} {final.get('error_message')}")
        print(f"OK: explore-planner graph registered (run status={status})")
        break
    time.sleep(1)
else:
    raise SystemExit("FAIL: explore-planner smoke run timed out")
PY

echo "Bridge:  http://host.docker.internal:17373 (token: $IDEPUS_BRIDGE_TOKEN)"
echo "Start idepus first (npm run tauri dev), open a workspace, then Tasks → Run"
