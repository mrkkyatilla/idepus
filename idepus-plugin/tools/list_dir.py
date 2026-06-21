from tools.registry.decorator import tool

from _bridge import call_bridge

LIST_DIR_SCHEMA = {
    "type": "object",
    "properties": {
        "path": {"type": "string"},
        "recursive": {"type": "boolean"},
    },
}


@tool("list_dir", LIST_DIR_SCHEMA)
def list_dir(path: str = "", recursive: bool = False, *, workspace_root: str = ".") -> dict:
    return call_bridge(
        "list_dir",
        {"path": path, "recursive": recursive},
        workspace_root=workspace_root,
    )
