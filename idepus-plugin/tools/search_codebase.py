from tools.registry.decorator import tool

from _bridge import call_bridge

SEARCH_SCHEMA = {
    "type": "object",
    "properties": {
        "query": {"type": "string"},
        "max_hits": {"type": "integer"},
        "limit": {"type": "integer"},
        "path_filter": {"type": "string"},
    },
    "required": ["query"],
}


@tool("search_codebase", SEARCH_SCHEMA)
def search_codebase(
    query: str,
    max_hits: int = 10,
    limit: int | None = None,
    path_filter: str | None = None,
    *,
    workspace_root: str = ".",
) -> dict:
    effective_limit = limit if limit is not None else max_hits
    payload: dict = {"query": query, "max_hits": effective_limit}
    if path_filter:
        payload["path_filter"] = path_filter
    return call_bridge(
        "search_codebase",
        payload,
        workspace_root=workspace_root,
    )
