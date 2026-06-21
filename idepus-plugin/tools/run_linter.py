from tools.registry.decorator import tool

from _bridge import call_bridge

LINTER_SCHEMA = {
    "type": "object",
    "properties": {"path": {"type": "string"}},
}


@tool("run_linter", LINTER_SCHEMA)
def run_linter(path: str = ".", *, workspace_root: str = ".") -> dict:
    return call_bridge("run_linter", {"path": path}, workspace_root=workspace_root)
