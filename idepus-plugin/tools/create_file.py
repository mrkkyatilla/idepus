from tools.registry.decorator import tool

from _bridge import call_bridge

CREATE_FILE_SCHEMA = {
    "type": "object",
    "properties": {
        "path": {"type": "string"},
        "content": {"type": "string"},
    },
    "required": ["path"],
}


@tool("create_file", CREATE_FILE_SCHEMA)
def create_file(
    path: str,
    content: str = "",
    *,
    workspace_root: str = ".",
) -> dict:
    return call_bridge(
        "create_file",
        {"path": path, "content": content},
        workspace_root=workspace_root,
    )
