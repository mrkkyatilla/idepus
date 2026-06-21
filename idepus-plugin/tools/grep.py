from tools.registry.decorator import tool

from _bridge import call_bridge

GREP_SCHEMA = {
    "type": "object",
    "properties": {
        "pattern": {"type": "string"},
        "path": {"type": "string"},
        "glob": {"type": "string"},
        "max_hits": {"type": "integer"},
    },
    "required": ["pattern"],
}


@tool("grep", GREP_SCHEMA)
def grep(
    pattern: str,
    path: str | None = None,
    glob: str | None = None,
    max_hits: int = 50,
    *,
    workspace_root: str = ".",
) -> dict:
    payload: dict = {"pattern": pattern, "max_hits": max_hits}
    if path:
        payload["path"] = path
    if glob:
        payload["glob"] = glob
    return call_bridge("grep", payload, workspace_root=workspace_root)
