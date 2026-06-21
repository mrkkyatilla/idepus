from tools.registry.decorator import tool

from _bridge import call_bridge

APPLY_PATCH_SCHEMA = {
    "type": "object",
    "properties": {
        "path": {"type": "string"},
        "raw_patch": {"type": "string"},
        "file_content": {"type": "string"},
        "accepted_ids": {
            "type": "array",
            "items": {"type": "string"},
        },
    },
    "required": ["path", "raw_patch"],
}


@tool("apply_patch", APPLY_PATCH_SCHEMA)
def apply_patch(
    path: str,
    raw_patch: str,
    file_content: str | None = None,
    accepted_ids: list[str] | None = None,
    *,
    workspace_root: str = ".",
) -> dict:
    args: dict = {"path": path, "raw_patch": raw_patch}
    if file_content is not None:
        args["file_content"] = file_content
    if accepted_ids:
        args["accepted_ids"] = accepted_ids
    return call_bridge("apply_patch", args, workspace_root=workspace_root)
