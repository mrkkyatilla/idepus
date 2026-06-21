"""HTTP bridge to idepus Tauri tool executor."""
from __future__ import annotations

import json
import os
import urllib.error
import urllib.request


def bridge_url() -> str:
    return os.environ.get("IDEPUS_BRIDGE_URL", "http://127.0.0.1:17373").rstrip("/")


def bridge_token() -> str:
    token = os.environ.get("IDEPUS_BRIDGE_TOKEN", "")
    if not token:
        raise RuntimeError("IDEPUS_BRIDGE_TOKEN is not set")
    return token


def call_bridge(tool: str, args: dict, *, workspace_root: str) -> dict:
    body = json.dumps({"workspace_root": workspace_root, "args": args}).encode("utf-8")
    req = urllib.request.Request(
        f"{bridge_url()}/v1/tools/{tool}",
        data=body,
        headers={
            "Content-Type": "application/json",
            "X-Bridge-Token": bridge_token(),
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as err:
        detail = err.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"bridge {tool} failed: {detail}") from err

    if not payload.get("ok"):
        raise RuntimeError(payload.get("error") or f"bridge {tool} failed")
    return payload.get("result") or {}
