from tools.registry.decorator import tool

from _bridge import call_bridge

DELETE_PATH_SCHEMA = {
    "type": "object",
    "properties": {
        "path": {"type": "string"},
        "recursive": {"type": "boolean"},
    },
    "required": ["path"],
}


@tool("delete_path", DELETE_PATH_SCHEMA)
def delete_path(
    path: str,
    recursive: bool = False,
    *,
    workspace_root: str = ".",
) -> dict:
    return call_bridge(
        "delete_path",
        {"path": path, "recursive": recursive},
        workspace_root=workspace_root,
    )
