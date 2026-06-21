from tools.registry.decorator import tool

from _bridge import call_bridge

SHADOW_VERIFY_SCHEMA = {
    "type": "object",
    "properties": {
        "path": {"type": "string"},
        "raw_patch": {"type": "string"},
        "file_content": {"type": "string"},
        "command": {"type": "string"},
        "args": {"type": "array", "items": {"type": "string"}},
        "timeout_secs": {"type": "integer"},
    },
    "required": ["path", "raw_patch", "file_content"],
}


@tool("shadow_verify", SHADOW_VERIFY_SCHEMA)
def shadow_verify(
    path: str,
    raw_patch: str,
    file_content: str,
    command: str | None = None,
    args: list[str] | None = None,
    timeout_secs: int | None = None,
    *,
    workspace_root: str = ".",
) -> dict:
    payload: dict = {
        "path": path,
        "raw_patch": raw_patch,
        "file_content": file_content,
    }
    if command:
        payload["command"] = command
    if args:
        payload["args"] = args
    if timeout_secs is not None:
        payload["timeout_secs"] = timeout_secs
    return call_bridge("shadow_verify", payload, workspace_root=workspace_root)
