from tools.registry.decorator import tool

from _bridge import call_bridge

WRITE_PLAN_SCHEMA = {
    "type": "object",
    "properties": {
        "title": {"type": "string"},
        "content": {"type": "string"},
        "plan_id": {"type": "string"},
        "run_id": {"type": "string"},
        "session_id": {"type": "string"},
    },
    "required": ["title", "content"],
}


@tool("write_plan_file", WRITE_PLAN_SCHEMA)
def write_plan_file(
    title: str,
    content: str,
    plan_id: str | None = None,
    run_id: str | None = None,
    session_id: str | None = None,
    *,
    workspace_root: str = ".",
) -> dict:
    payload: dict = {"title": title, "content": content}
    if plan_id:
        payload["plan_id"] = plan_id
    if run_id:
        payload["run_id"] = run_id
    if session_id:
        payload["session_id"] = session_id
    return call_bridge("write_plan_file", payload, workspace_root=workspace_root)
