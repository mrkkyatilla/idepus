from tools.registry.decorator import tool

from _bridge import call_bridge

FETCH_URL_SCHEMA = {
    "type": "object",
    "properties": {
        "url": {"type": "string"},
    },
    "required": ["url"],
}


@tool("fetch_url", FETCH_URL_SCHEMA)
def fetch_url(url: str, *, workspace_root: str = ".") -> dict:
    return call_bridge("fetch_url", {"url": url}, workspace_root=workspace_root)
