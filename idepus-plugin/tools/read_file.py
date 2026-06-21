from tools.registry.decorator import tool

from _bridge import call_bridge

READ_FILE_SCHEMA = {
    "type": "object",
    "properties": {"path": {"type": "string"}},
    "required": ["path"],
}


@tool("read_file", READ_FILE_SCHEMA)
def read_file(path: str, *, workspace_root: str = ".") -> dict:
    return call_bridge("read_file", {"path": path}, workspace_root=workspace_root)
