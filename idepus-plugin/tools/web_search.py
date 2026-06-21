from tools.registry.decorator import tool

from _bridge import call_bridge

WEB_SEARCH_SCHEMA = {
    "type": "object",
    "properties": {
        "query": {"type": "string"},
        "max_results": {"type": "integer"},
    },
    "required": ["query"],
}


@tool("web_search", WEB_SEARCH_SCHEMA)
def web_search(
    query: str,
    max_results: int = 5,
    *,
    workspace_root: str = ".",
) -> dict:
    return call_bridge(
        "web_search",
        {"query": query, "max_results": max_results},
        workspace_root=workspace_root,
    )
