from __future__ import annotations

import os
import re

FILE_EXTENSIONS = (
    "ts", "tsx", "js", "jsx", "rs", "py", "md", "json", "yaml", "yml", "toml",
    "sh", "bat", "ps1", "html", "htm", "css", "vue", "svg",
)


def _is_valid_patch_text(text: str) -> bool:
    return "<<<<<<< SEARCH" in text and ">>>>>>> REPLACE" in text


def _use_mock_provider() -> bool:
    return os.environ.get("USE_MOCK_PROVIDER", "").lower() in ("1", "true", "yes")


def _extract_declared_target_files(text: str) -> list[str]:
    match = re.search(r"\[Target files\]\s*\n((?:- [^\n]+\n?)+)", text, re.I)
    if not match:
        return []
    out: list[str] = []
    for line in match.group(1).splitlines():
        stripped = line.strip()
        if stripped.startswith("- "):
            path = stripped[2:].strip()
            if path and path not in out:
                out.append(path)
    return out


def _task_text(user_text: str) -> str:
    marker = "[Task]"
    idx = user_text.rfind(marker)
    if idx == -1:
        return user_text
    return user_text[idx + len(marker) :].strip()


def _format_target_files_prompt(user_text: str) -> str:
    declared = _extract_declared_target_files(user_text)
    if not declared:
        return ""
    lines = "\n".join(f"- {path}" for path in declared)
    return f"Target files (only edit these):\n{lines}\n\n"


def _extract_filename_hint(text: str) -> str | None:
    ext_group = "|".join(FILE_EXTENSIONS)
    match = re.search(rf"@?([\w./-]+\.(?:{ext_group}))\b", text, re.I)
    if match:
        return match.group(1).replace("\\", "/")
    match = re.search(
        r"\b([\w.-]+)\s+dosyas(?:ı|ına|ını|ında|asına|ası|ıyla|iyle)\b",
        text,
        re.I,
    )
    if match:
        name = match.group(1).replace("\\", "/")
        if "." not in name.split("/")[-1]:
            return f"{name}.md" if "/" not in name else name
        return name
    match = re.search(
        r"(?:only focus on|just edit|only edit|focus on|sadece|yalnızca)\s+(@?[\w./-]+)",
        text,
        re.I,
    )
    if match:
        name = match.group(1).lstrip("@").replace("\\", "/")
        if "." not in name.split("/")[-1]:
            return f"{name}.md" if "/" not in name else name
        return name
    match = re.search(
        r"(?:sadece|yalnızca)\s+([\w./-]+)\s+ile\s+ilgilen",
        text,
        re.I,
    )
    if match:
        name = match.group(1).lstrip("@").replace("\\", "/")
        if "." not in name.split("/")[-1]:
            return f"{name}.md" if "/" not in name else name
        return name
    match = re.search(r"\b([\w.-]+)\s+html\b", text, re.I)
    if match:
        return f"{match.group(1)}.html"
    return None


def _extract_mock_insert_text(task: str) -> str | None:
    task = task.strip()
    if not task:
        return None
    for pattern in (
        r'"([^"]{1,500})"',
        r"'([^']{1,500})'",
        r'"([^"]{1,500})"',
        r'"([^"]{1,500})"',
        r"«([^»]{1,500})»",
        r'„([^”]{1,500})”',
    ):
        match = re.search(pattern, task)
        if match:
            text = match.group(1).strip()
            if text:
                return text
    match = re.search(r"(#\S[^\s\"']{1,200})", task)
    if match:
        return match.group(1).strip()
    match = re.search(
        r"(?:yaz(?:ar)?\s*mısın|yaz(?:dır)?|write|add|insert|ekle)[:\s]+(.+)$",
        task,
        re.I,
    )
    if match:
        text = match.group(1).strip().strip("\"'«»""„")
        if text:
            return text
    return None


def _mock_patch_for_content(content: str, task: str = "") -> str:
    insert = _extract_mock_insert_text(task)
    if content.startswith("Workspace listing:"):
        content = ""
    lines = content.splitlines()
    anchor = ""
    for line in reversed(lines):
        if line.strip():
            anchor = line
            break
    if not anchor:
        new_line = insert or "# agent: mock edit"
        return (
            "<<<<<<< SEARCH\n"
            "=======\n"
            f"{new_line}\n"
            ">>>>>>> REPLACE"
        )
    replacement = f"{anchor}\n{insert}" if insert else f"{anchor}\n# agent: mock edit"
    return (
        "<<<<<<< SEARCH\n"
        f"{anchor}\n"
        "=======\n"
        f"{replacement}\n"
        ">>>>>>> REPLACE"
    )


def _finalize_patch_text(
    patch_text: str,
    content: str,
    task_text: str,
    *,
    path: str = "",
) -> tuple[str | None, list[dict], bool]:
    """Return (patch, extra_messages, patch_failed)."""
    if _use_mock_provider():
        notice = (
            "[Mock LLM mode] Patch synthesized locally — add API keys in "
            "Settings and run ./scripts/aicery-reload-provider.sh for real edits."
        )
        return _mock_patch_for_content(content, task_text), [
            {"role": "assistant", "content": notice},
        ], False
    if _is_valid_patch_text(patch_text):
        return patch_text, [], False
    preview = patch_text.strip().replace("\n", " ")[:240]
    target = path or "file"
    detail = (
        f"LLM did not return a valid SEARCH/REPLACE patch for {target}. "
        f"Response preview: {preview}"
    )
    return None, [{"role": "assistant", "content": detail}], True
