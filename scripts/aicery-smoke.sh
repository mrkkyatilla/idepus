#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
AICERY_URL="${AICERY_RUNTIME_URL:-http://localhost:8000}"
API_KEY="${API_KEY:-dev}"

echo "== idepus Aicery smoke =="
echo "Runtime: $AICERY_URL"

if ! curl -sf "$AICERY_URL/v1/agents" -H "X-API-Key: $API_KEY" >/dev/null; then
  echo "FAIL: Aicery sidecar not reachable at $AICERY_URL"
  echo "Start with: ./scripts/aicery-up.sh"
  exit 1
fi

echo "OK: sidecar health"

if command -v python3 >/dev/null 2>&1; then
  python3 - <<'PY'
import json
import os
import urllib.request

base = os.environ.get("AICERY_RUNTIME_URL", "http://localhost:8000").rstrip("/")
key = os.environ.get("API_KEY", "dev")

def get_agents():
    req = urllib.request.Request(
        f"{base}/v1/agents",
        headers={"X-API-Key": key},
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode())

agents = get_agents()
ids = [a.get("id", a) if isinstance(a, dict) else str(a) for a in agents]
print(f"OK: agents={', '.join(ids) or 'none'}")
for required in ("code-editor", "code-explorer", "explore-planner", "lint-fix", "multi-file-editor"):
    if required not in ids:
        raise SystemExit(f"FAIL: missing agent {required!r} — set PLUGIN_PATHS=idepus-plugin")

print("OK: multi-file-editor agent registered")

body = json.dumps({"agent_id": "echo", "input": "hello", "execute": True}).encode()
req = urllib.request.Request(
    f"{base}/v1/runs",
    data=body,
    headers={"Content-Type": "application/json", "X-API-Key": key},
    method="POST",
)
with urllib.request.urlopen(req, timeout=30) as resp:
    run = json.loads(resp.read().decode())
run_id = run["id"]
print(f"OK: createRun echo id={run_id}")

with urllib.request.urlopen(
    urllib.request.Request(
        f"{base}/v1/runs/{run_id}",
        headers={"X-API-Key": key},
    ),
    timeout=30,
) as resp:
    final = json.loads(resp.read().decode())
print(f"OK: getRun status={final.get('status')}")
PY
else
  echo "SKIP: python3 not available for createRun smoke"
fi

echo "== smoke complete =="
