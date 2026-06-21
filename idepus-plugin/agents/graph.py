from __future__ import annotations

import os
import re
import sys
from pathlib import Path
from typing import TypedDict

from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.graph import END, StateGraph

_agents_dir = str(Path(__file__).resolve().parent)
if _agents_dir not in sys.path:
    sys.path.insert(0, _agents_dir)

from path_hints import (  # noqa: E402
    FILE_EXTENSIONS,
    _extract_declared_target_files,
    _extract_filename_hint,
    _finalize_patch_text,
    _format_target_files_prompt,
    _is_valid_patch_text,
    _mock_patch_for_content,
    _task_text,
    _use_mock_provider,
)
from agents.registry import register_plugin_agent
from core.domain.replay import ReplayContext
from core.domain.run import Run
from core.ports.provider import ProviderPort
from core.ports.tool_executor import ToolExecutorPort
from runtime.adapters.langgraph.chain_hitl import invoke_tool_with_hitl
from runtime.errors import GraphStepLimitError
from runtime.observability.graph_policy_context import get_max_graph_steps

EXPLAIN_SYSTEM = """You explain code and scripts clearly for the developer.
Answer in the same language as the user's question (Turkish or English).
Do not propose edits or patches — only explain what the file does."""


def _is_analysis_task(text: str) -> bool:
    lower = text.lower()
    analysis_markers = (
        "analiz",
        "analyze",
        "analyse",
        "explain",
        "what does",
        "what is",
        "ne işe yarı",
        "ne işe",
        "ne yapıyor",
        "ne durumda",
        "describe",
        "incele",
        "tell me",
        "summarize",
        "summary",
        "özet",
        "açıkla",
        "how does",
        "nasıl çalış",
        "bul ",
        "find ",
        "locate",
        "where is",
        "nerede",
    )
    edit_markers = (
        "fix",
        "patch",
        "edit",
        "change",
        "add ",
        "remove",
        "delete",
        "create",
        "implement",
        "refactor",
        "update",
        "write",
        "düzelt",
        "ekle",
        "oluştur",
        "değiştir",
        "yaz",
        "kaldır",
        "apply",
    )
    if not any(marker in lower for marker in analysis_markers):
        return False
    return not any(marker in lower for marker in edit_markers)


def _mock_explain(path: str, content: str, question: str) -> str:
    lines = content.splitlines()
    non_empty = [ln for ln in lines if ln.strip()]
    name = path.split("/")[-1] or path
    bullets: list[str] = [f"~{len(lines)} lines"]
    if lines and lines[0].startswith("#!"):
        bullets.append(f"Interpreter: `{lines[0].strip()}`")
    if any("main" in ln for ln in non_empty[:40]):
        bullets.append("References `main` (likely entrypoint)")
    if name.endswith(".sh"):
        bullets.append("Shell script — typically runs commands or delegates to functions")
    preview = "\n".join(lines[:25])
    bullet_text = "\n".join(f"- {b}" for b in bullets)
    return (
        f"**{name}** (dev mock — add an LLM API key in Settings for a full answer)\n\n"
        f"Question: {question}\n\n"
        f"{bullet_text}\n\n"
        f"```\n{preview}\n```"
    )


SEARCH_REPLACE_SYSTEM = """You edit code using SEARCH/REPLACE blocks only.
Return one or more blocks in this exact format:

<<<<<<< SEARCH
exact old text
=======
new text
>>>>>>> REPLACE

No markdown fences or explanation outside the blocks."""


def _path_matches_target(path: str, target: str) -> bool:
    norm_path = path.replace("\\", "/").lower()
    norm_target = target.replace("\\", "/").lower().rstrip("/")
    basename = norm_target.split("/")[-1]
    return (
        norm_path == norm_target
        or norm_path.endswith(f"/{norm_target}")
        or norm_path.split("/")[-1] == basename
    )


class EditorState(TypedDict):
    messages: list[dict]
    artifacts: dict
    step_index: int


FOLDER_HINTS: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"\bfrontend\b", re.I), "frontend"),
    (re.compile(r"\bbackend\b", re.I), "backend"),
    (re.compile(r"\bsrc\b", re.I), "src"),
)


def _extract_folder_hint(text: str) -> str | None:
    for pattern, folder in FOLDER_HINTS:
        if pattern.search(text):
            return folder
    match = re.search(r"(?:in|içindeki|klasöründeki|folder)\s+([\w.-]+)", text, re.I)
    if match:
        return match.group(1).lower()
    return None


def _score_candidate(
    path: str,
    folder_hint: str | None,
    filename_hint: str | None,
    declared: list[str] | None = None,
) -> int:
    normalized = path.replace("\\", "/").lower()
    if declared:
        for index, decl in enumerate(declared):
            decl_norm = decl.replace("\\", "/").lower().rstrip("/")
            basename = decl_norm.split("/")[-1]
            if (
                normalized == decl_norm
                or normalized.endswith(f"/{decl_norm}")
                or normalized.split("/")[-1] == basename
            ):
                return 1000 - index
    score = 0
    if filename_hint:
        basename = filename_hint.lower().split("/")[-1]
        if normalized.endswith(f"/{basename}") or normalized == basename:
            score += 20
        elif basename in normalized:
            score += 5
    if folder_hint:
        folder = folder_hint.lower()
        if f"/{folder}/" in f"/{normalized}/" or normalized.startswith(f"{folder}/"):
            score += 15
    if any(part in normalized for part in ("/dist/", "/venv/", "node_modules", "site-packages")):
        score -= 30
    return score


def _extract_path(text: str) -> str | None:
    ext_group = "|".join(FILE_EXTENSIONS)
    patterns = [
        rf"[\w./-]+\.(?:{ext_group})",
        r"[\w./-]+\.\w+",
    ]
    for pattern in patterns:
        match = re.search(pattern, text, re.I)
        if match:
            return match.group(0).replace("\\", "/")
    return _extract_filename_hint(text)


async def _collect_path_candidates(
    user_text: str,
    hits: list,
    tools: ToolExecutorPort,
    run: Run,
) -> list[str]:
    declared = _extract_declared_target_files(user_text)
    task_text = _task_text(user_text)
    extracted = _extract_path(task_text)
    filename_hint = _extract_filename_hint(task_text)
    folder_hint = _extract_folder_hint(task_text)
    candidates: list[str] = []

    def add(path: str | None) -> None:
        if path and path not in (".", "") and path not in candidates:
            candidates.append(path)

    for path in declared:
        add(path)
    add(extracted)
    if filename_hint and folder_hint:
        add(f"{folder_hint}/{filename_hint.split('/')[-1]}")
    if filename_hint:
        add(filename_hint.split("/")[-1])

    search_queries: list[str] = []
    for path in declared:
        search_queries.append(path.split("/")[-1])
    if filename_hint:
        search_queries.append(filename_hint.split("/")[-1])
    if filename_hint and folder_hint:
        search_queries.append(f"{folder_hint}/{filename_hint.split('/')[-1]}")
    if folder_hint:
        search_queries.append(folder_hint)
    search_queries.append(task_text[:80])

    seen_queries: set[str] = set()
    for query in search_queries:
        key = query.strip().lower()
        if not key or key in seen_queries:
            continue
        seen_queries.add(key)
        try:
            outcome = await tools.invoke(
                "search_codebase",
                {"query": query, "max_hits": 10},
                run_id=run.id,
                agent_id=run.agent_id,
            )
            for hit in outcome["result"].get("hits", []):
                add(str(hit.get("path", "") or "").strip())
        except Exception:
            pass

    for hit in hits:
        add(str(hit.get("path", "") or "").strip())

    if folder_hint:
        try:
            list_outcome = await tools.invoke(
                "list_dir",
                {"path": folder_hint, "recursive": True},
                run_id=run.id,
                agent_id=run.agent_id,
            )
            target_name = (filename_hint or "").split("/")[-1].lower()
            for entry in list_outcome["result"].get("entries", []):
                if entry.get("is_dir"):
                    continue
                name = str(entry.get("name", "")).lower()
                if not target_name or name == target_name:
                    add(str(entry.get("path", "") or "").strip())
        except Exception:
            pass

    ranked = sorted(
        candidates,
        key=lambda path: _score_candidate(path, folder_hint, filename_hint, declared),
        reverse=True,
    )
    return ranked


async def _read_file_or_empty(
    path: str,
    tools: ToolExecutorPort,
    run: Run,
) -> tuple[str, str] | None:
    if not path or path in (".", ""):
        return None
    try:
        read_outcome = await tools.invoke(
            "read_file",
            {"path": path},
            run_id=run.id,
            agent_id=run.agent_id,
        )
        content = read_outcome["result"].get("content", "")
        if content and not content.startswith("Workspace listing:"):
            return path, content
    except Exception:
        pass
    return path, ""


async def _find_declared_path(
    declared_path: str,
    tools: ToolExecutorPort,
    run: Run,
) -> tuple[str, str]:
    direct = await _read_file_or_empty(declared_path, tools, run)
    if direct is not None and direct[1]:
        return direct
    basename = declared_path.replace("\\", "/").split("/")[-1]
    try:
        outcome = await tools.invoke(
            "search_codebase",
            {"query": basename, "max_hits": 12},
            run_id=run.id,
            agent_id=run.agent_id,
        )
        for hit in outcome["result"].get("hits", []):
            hit_path = str(hit.get("path", "") or "").strip()
            if not hit_path or not _path_matches_target(hit_path, declared_path):
                continue
            found = await _read_file_or_empty(hit_path, tools, run)
            if found is not None:
                return found
    except Exception:
        pass
    if direct is not None:
        return direct
    return declared_path, ""


def _search_query_for_gather(user_text: str) -> str:
    declared = _extract_declared_target_files(user_text)
    if declared:
        return declared[0].split("/")[-1]
    task_text = _task_text(user_text)
    return task_text[:120] if task_text else user_text[:120]


async def _resolve_target_file(
    user_text: str,
    hits: list,
    tools: ToolExecutorPort,
    run: Run,
) -> tuple[str, str]:
    declared = _extract_declared_target_files(user_text)
    task_text = _task_text(user_text)
    filename_hint = _extract_filename_hint(task_text)
    explicit = declared or ([filename_hint] if filename_hint else [])
    for path in explicit:
        resolved = await _find_declared_path(path, tools, run)
        return resolved

    for path in await _collect_path_candidates(user_text, hits, tools, run):
        resolved = await _read_file_or_empty(path, tools, run)
        if resolved is not None and resolved[1]:
            return resolved

    list_outcome = await tools.invoke(
        "list_dir",
        {"path": "", "recursive": False},
        run_id=run.id,
        agent_id=run.agent_id,
    )
    entries = list_outcome["result"].get("entries", [])
    listing = "\n".join(
        f"- {e.get('name', '?')}{'/' if e.get('is_dir') else ''}"
        for e in entries[:60]
    )
    return ".", f"Workspace listing:\n{listing}"


def build_code_editor_graph(
    provider: ProviderPort,
    tools: ToolExecutorPort | None = None,
    run: Run | None = None,
    *,
    checkpointer: BaseCheckpointSaver | None = None,
    replay_ctx: ReplayContext | None = None,
):
    if tools is None or run is None:
        raise ValueError("code-editor requires tools and run")

    max_steps = get_max_graph_steps()
    ctx = replay_ctx or ReplayContext()

    def _check_step_limit(state: EditorState) -> None:
        if state.get("step_index", 0) >= max_steps:
            raise GraphStepLimitError()

    async def gather(state: EditorState) -> dict:
        _check_step_limit(state)
        user_text = run.input_text or state["messages"][-1]["content"]
        hits: list = []
        try:
            outcome = await tools.invoke(
                "search_codebase",
                {"query": _search_query_for_gather(user_text), "max_hits": 5},
                run_id=run.id,
                agent_id=run.agent_id,
            )
            hits = outcome["result"].get("hits", [])
        except Exception:
            hits = []

        path, content = await _resolve_target_file(user_text, hits, tools, run)

        return {
            "messages": state["messages"],
            "artifacts": {"path": path, "content": content, "hits": hits},
            "step_index": state.get("step_index", 0) + 1,
        }

    async def explain(state: EditorState) -> dict:
        _check_step_limit(state)
        path = state["artifacts"]["path"]
        content = state["artifacts"]["content"]
        user_text = run.input_text or ""
        summary = await provider.complete(
            [
                {"role": "system", "content": EXPLAIN_SYSTEM},
                {
                    "role": "user",
                    "content": (
                        f"File: {path}\n\nContent:\n{content[:12000]}\n\n"
                        f"Question: {user_text}"
                    ),
                },
            ]
        )
        return {
            "messages": [
                *state["messages"],
                {"role": "assistant", "content": summary},
            ],
            "artifacts": {**state["artifacts"], "mode": "explain"},
            "step_index": state.get("step_index", 0) + 1,
        }

    def route_after_gather(state: EditorState) -> str:
        user_text = run.input_text or ""
        if _is_analysis_task(user_text):
            return "explain"
        path = str(state["artifacts"].get("path") or "")
        if path in (".", ""):
            return "explain"
        return "propose_patch"

    async def propose_patch(state: EditorState) -> dict:
        _check_step_limit(state)
        path = state["artifacts"]["path"]
        content = state["artifacts"]["content"]
        user_text = run.input_text or ""
        task_text = _task_text(user_text)
        target_block = _format_target_files_prompt(user_text)
        patch_text = await provider.complete(
            [
                {"role": "system", "content": SEARCH_REPLACE_SYSTEM},
                {
                    "role": "user",
                    "content": (
                        f"{target_block}File: {path}\n\n"
                        f"Current content:\n{content[:12000]}\n\n"
                        f"Task: {task_text}"
                    ),
                },
            ]
        )
        resolved, extra_messages, patch_failed = _finalize_patch_text(
            patch_text,
            content,
            task_text,
            path=path,
        )
        artifacts = {**state["artifacts"], "patch_failed": patch_failed}
        if resolved is not None:
            artifacts["raw_patch"] = resolved
        return {
            "messages": [*state["messages"], *extra_messages],
            "artifacts": artifacts,
            "step_index": state.get("step_index", 0) + 1,
        }

    def route_after_propose_patch(state: EditorState) -> str:
        if state["artifacts"].get("patch_failed"):
            return "end"
        return "verify_shadow"

    async def verify_shadow(state: EditorState) -> dict:
        _check_step_limit(state)
        path = state["artifacts"]["path"]
        raw_patch = state["artifacts"]["raw_patch"]
        content = state["artifacts"]["content"]
        try:
            outcome = await tools.invoke(
                "shadow_verify",
                {
                    "path": path,
                    "raw_patch": raw_patch,
                    "file_content": content,
                },
                run_id=run.id,
                agent_id=run.agent_id,
            )
            result = outcome.get("result", {})
            if not result.get("passed"):
                summary = result.get("stderr_summary") or "shadow verify failed"
                return {
                    "messages": [
                        *state["messages"],
                        {"role": "assistant", "content": f"Shadow test failed: {summary}"},
                    ],
                    "artifacts": {**state["artifacts"], "shadow_failed": True},
                    "step_index": state.get("step_index", 0) + 1,
                }
        except Exception as exc:
            return {
                "messages": [
                    *state["messages"],
                    {"role": "assistant", "content": f"Shadow verify error: {exc}"},
                ],
                "artifacts": {**state["artifacts"], "shadow_failed": True},
                "step_index": state.get("step_index", 0) + 1,
            }
        return {
            "messages": state["messages"],
            "artifacts": {**state["artifacts"], "shadow_failed": False},
            "step_index": state.get("step_index", 0) + 1,
        }

    def route_after_shadow(state: EditorState) -> str:
        if state["artifacts"].get("shadow_failed"):
            return "end"
        return "apply"

    async def apply(state: EditorState) -> dict:
        _check_step_limit(state)
        path = state["artifacts"]["path"]
        raw_patch = state["artifacts"]["raw_patch"]
        content = state["artifacts"]["content"]
        outcome = await invoke_tool_with_hitl(
            "apply_patch",
            {"path": path, "raw_patch": raw_patch, "file_content": content},
            tools=tools,
            run=run,
            node="apply",
            replay_ctx=ctx,
            graph="code-editor",
        )
        result = outcome.get("result", {})
        try:
            await tools.invoke(
                "run_linter",
                {"path": path},
                run_id=run.id,
                agent_id=run.agent_id,
            )
        except Exception:
            pass
        summary = f"Applied patch to {path}: {result}"
        return {
            "messages": [
                *state["messages"],
                {"role": "assistant", "content": summary},
            ],
            "artifacts": {**state["artifacts"], "apply_result": result},
            "step_index": state.get("step_index", 0) + 1,
        }

    graph = StateGraph(EditorState)
    graph.add_node("gather", gather)
    graph.add_node("explain", explain)
    graph.add_node("propose_patch", propose_patch)
    graph.add_node("verify_shadow", verify_shadow)
    graph.add_node("apply", apply)
    graph.set_entry_point("gather")
    graph.add_conditional_edges(
        "gather",
        route_after_gather,
        {"explain": "explain", "propose_patch": "propose_patch"},
    )
    graph.add_edge("explain", END)
    graph.add_conditional_edges(
        "propose_patch",
        route_after_propose_patch,
        {"verify_shadow": "verify_shadow", "end": END},
    )
    graph.add_conditional_edges(
        "verify_shadow",
        route_after_shadow,
        {"apply": "apply", "end": END},
    )
    graph.add_edge("apply", END)
    return graph.compile(checkpointer=checkpointer)


register_plugin_agent("code-editor", build_code_editor_graph)


CODE_EXPLORER_SYSTEM = """You explore codebases in read-only mode.
Use search and file reading context to answer questions accurately.
Never propose file edits, patches, or apply_patch calls.
Answer in the same language as the user's question (Turkish or English)."""


def build_code_explorer_graph(
    provider: ProviderPort,
    tools: ToolExecutorPort | None = None,
    run: Run | None = None,
    *,
    checkpointer: BaseCheckpointSaver | None = None,
    replay_ctx: ReplayContext | None = None,
):
    if tools is None or run is None:
        raise ValueError("code-explorer requires tools and run")

    max_steps = get_max_graph_steps()

    def _check_step_limit(state: EditorState) -> None:
        if state.get("step_index", 0) >= max_steps:
            raise GraphStepLimitError()

    async def gather(state: EditorState) -> dict:
        _check_step_limit(state)
        user_text = run.input_text or state["messages"][-1]["content"]
        hits: list = []
        try:
            outcome = await tools.invoke(
                "search_codebase",
                {"query": _search_query_for_gather(user_text), "max_hits": 5},
                run_id=run.id,
                agent_id=run.agent_id,
            )
            hits = outcome["result"].get("hits", [])
        except Exception:
            hits = []

        path, content = await _resolve_target_file(user_text, hits, tools, run)

        web_refs: list = []
        if _needs_web_research(user_text):
            web_refs = await _invoke_web_search(tools, run, _web_search_query(user_text))

        return {
            "messages": state["messages"],
            "artifacts": {"path": path, "content": content, "hits": hits, "web_references": web_refs},
            "step_index": state.get("step_index", 0) + 1,
        }

    async def explain(state: EditorState) -> dict:
        _check_step_limit(state)
        path = state["artifacts"]["path"]
        content = state["artifacts"]["content"]
        user_text = run.input_text or ""
        web_block = _format_web_references(state["artifacts"].get("web_references", []))
        summary = await provider.complete(
            [
                {"role": "system", "content": CODE_EXPLORER_SYSTEM},
                {
                    "role": "user",
                    "content": (
                        f"File: {path}\n\nContent:\n{content[:12000]}\n\n"
                        f"{web_block}\n\n"
                        f"Question: {user_text}"
                    ),
                },
            ]
        )
        return {
            "messages": [
                *state["messages"],
                {"role": "assistant", "content": summary},
            ],
            "artifacts": {**state["artifacts"], "mode": "explore"},
            "step_index": state.get("step_index", 0) + 1,
        }

    graph = StateGraph(EditorState)
    graph.add_node("gather", gather)
    graph.add_node("explain", explain)
    graph.set_entry_point("gather")
    graph.add_edge("gather", "explain")
    graph.add_edge("explain", END)
    return graph.compile(checkpointer=checkpointer)


register_plugin_agent("code-explorer", build_code_explorer_graph)


MAX_EXPLORE_ITERATIONS = 3
PLANNER_STEP_BUDGET = 14
MULTI_FILE_STEP_BUDGET = 14
MAX_TOOL_CALLS_PER_ITER = 3

EXPLORE_PLANNER_SYSTEM = """You explore codebases and produce implementation plans.
Use prior exploration context. Output clear markdown with Summary, Steps (checkboxes), and References.
Never propose file edits or patches — only planning."""


def _extract_grep_terms(text: str) -> list[str]:
    stop = {
        "the", "and", "for", "with", "from", "that", "this", "into", "your",
        "bir", "ve", "ile", "için", "olan", "gibi", "plan", "mode",
    }
    terms: list[str] = []
    path = _extract_path(text)
    if path:
        base = path.split("/")[-1]
        terms.append(base)
        if "." in base:
            terms.append(base.rsplit(".", 1)[0])
    for match in re.finditer(r"[\w]{3,}", text):
        word = match.group(0)
        if word.lower() not in stop and word not in terms:
            terms.append(word)
        if len(terms) >= 6:
            break
    if not terms:
        terms.append(text[:48].strip() or "main")
    return terms[:6]


def _grep_queries_for_iteration(user_text: str, iteration: int, terms: list[str]) -> list[str]:
    if iteration == 0 and terms:
        return terms[:3]
    if iteration == 1:
        path = _extract_path(user_text)
        if path:
            return [path.split("/")[-1], path]
    if iteration == 2:
        folder = _extract_folder_hint(user_text)
        if folder:
            return [folder]
    if iteration >= 3:
        return [user_text[:60]]
    return terms[iteration : iteration + 2] or [user_text[:60]]


def _format_references(references: list[dict]) -> str:
    lines: list[str] = []
    seen: set[str] = set()
    for ref in references:
        path = ref.get("path", "")
        if not path or path in seen:
            continue
        seen.add(path)
        start = ref.get("start_line")
        end = ref.get("end_line")
        if start and end and start != end:
            lines.append(f"- {path} (L{start}–{end})")
        elif start:
            lines.append(f"- {path} (L{start})")
        else:
            lines.append(f"- {path}")
    return "\n".join(lines)


def _mock_plan_markdown(title: str, references: list[dict], user_text: str) -> str:
    refs = _format_references(references) or "- (explore with grep/read_file for references)"
    return (
        f"# Plan: {title}\n\n"
        "## Summary\n"
        f"Address: {user_text[:200]}\n\n"
        "## Steps\n"
        "- [ ] Step 1: Review referenced files\n"
        "- [ ] Step 2: Apply targeted changes\n"
        "- [ ] Step 3: Verify with tests or linter\n\n"
        "## References\n"
        f"{refs}\n"
    )


_WEB_RESEARCH_HINTS = (
    "breaking change",
    "release note",
    "documentation",
    "latest version",
    "how to",
    "what is",
    "react ",
    "next.js",
    "vue ",
    "angular",
    "svelte",
    "http://",
    "https://",
    "api ",
    "npm ",
    "pypi",
    "crate ",
)


def _needs_web_research(user_text: str) -> bool:
    lower = user_text.lower()
    if any(hint in lower for hint in _WEB_RESEARCH_HINTS):
        return True
    if re.search(r"\b20\d{2}\b", lower):
        return True
    return False


def _web_search_query(user_text: str) -> str:
    first = user_text.strip().split("\n")[0]
    return first[:160] or user_text[:160]


def _format_web_references(refs: list[dict]) -> str:
    if not refs:
        return ""
    lines = ["## Web sources"]
    for ref in refs[:5]:
        title = ref.get("title") or ref.get("url") or "Source"
        url = ref.get("url", "")
        snippet = ref.get("snippet", "")
        line = f"- [{title}]({url})" if url else f"- {title}"
        if snippet:
            line += f" — {snippet[:120]}"
        lines.append(line)
    return "\n".join(lines)


async def _invoke_web_search(
    tools: ToolExecutorPort,
    run: Run,
    query: str,
    *,
    max_results: int = 5,
) -> list[dict]:
    try:
        outcome = await tools.invoke(
            "web_search",
            {"query": query, "max_results": max_results},
            run_id=run.id,
            agent_id=run.agent_id,
        )
        return list(outcome["result"].get("results", []))
    except Exception:
        return []


class ExplorePlannerState(TypedDict):
    messages: list[dict]
    artifacts: dict
    step_index: int


def build_explore_planner_graph(
    provider: ProviderPort,
    tools: ToolExecutorPort | None = None,
    run: Run | None = None,
    *,
    checkpointer: BaseCheckpointSaver | None = None,
    replay_ctx: ReplayContext | None = None,
):
    if tools is None or run is None:
        raise ValueError("explore-planner requires tools and run")

    max_steps = max(get_max_graph_steps(), PLANNER_STEP_BUDGET)

    def _check_step_limit(state: ExplorePlannerState) -> None:
        if state.get("step_index", 0) >= max_steps:
            raise GraphStepLimitError()

    async def gather_context(state: ExplorePlannerState) -> dict:
        user_text = run.input_text or state["messages"][-1]["content"]
        return {
            "messages": state["messages"],
            "artifacts": {
                "user_text": user_text,
                "explore_iteration": 0,
                "grep_terms": _extract_grep_terms(user_text),
                "references": [],
                "files_read": {},
            },
            "step_index": state.get("step_index", 0),
        }

    async def explore_loop(state: ExplorePlannerState) -> dict:
        _check_step_limit(state)
        artifacts = dict(state["artifacts"])
        iteration: int = artifacts.get("explore_iteration", 0)
        user_text: str = artifacts.get("user_text", "")
        references: list = list(artifacts.get("references", []))
        files_read: dict = dict(artifacts.get("files_read", {}))
        grep_terms: list = artifacts.get("grep_terms", [])
        tool_calls = 0

        queries = _grep_queries_for_iteration(user_text, iteration, grep_terms)
        for query in queries:
            if tool_calls >= MAX_TOOL_CALLS_PER_ITER:
                break
            try:
                outcome = await tools.invoke(
                    "grep",
                    {"pattern": query, "max_hits": 8},
                    run_id=run.id,
                    agent_id=run.agent_id,
                )
                tool_calls += 1
                hits = outcome["result"].get("hits", [])
                for hit in hits[:2]:
                    path = hit.get("path")
                    if not path or path in files_read:
                        continue
                    if tool_calls >= MAX_TOOL_CALLS_PER_ITER:
                        break
                    read_outcome = await tools.invoke(
                        "read_file",
                        {"path": path},
                        run_id=run.id,
                        agent_id=run.agent_id,
                    )
                    tool_calls += 1
                    content = read_outcome["result"].get("content", "")
                    if content and not content.startswith("Workspace listing:"):
                        files_read[path] = content[:8000]
                        references.append(
                            {
                                "path": path,
                                "start_line": hit.get("start_line"),
                                "end_line": hit.get("end_line"),
                            }
                        )
            except Exception:
                continue

        if iteration == 0 and not files_read:
            try:
                list_outcome = await tools.invoke(
                    "list_dir",
                    {"path": "", "recursive": False},
                    run_id=run.id,
                    agent_id=run.agent_id,
                )
                entries = list_outcome["result"].get("entries", [])
                for entry in entries[:5]:
                    name = entry.get("name", "")
                    if entry.get("is_dir") or not name:
                        continue
                    try:
                        read_outcome = await tools.invoke(
                            "read_file",
                            {"path": name},
                            run_id=run.id,
                            agent_id=run.agent_id,
                        )
                        content = read_outcome["result"].get("content", "")
                        if content and not content.startswith("Workspace listing:"):
                            files_read[name] = content[:4000]
                            references.append({"path": name})
                    except Exception:
                        continue
            except Exception:
                pass

        return {
            "messages": state["messages"],
            "artifacts": {
                **artifacts,
                "explore_iteration": iteration + 1,
                "references": references,
                "files_read": files_read,
            },
            "step_index": state.get("step_index", 0) + 1,
        }

    def route_after_explore(state: ExplorePlannerState) -> str:
        iteration = state["artifacts"].get("explore_iteration", 0)
        refs = state["artifacts"].get("references", [])
        if iteration < MAX_EXPLORE_ITERATIONS and len(refs) < 3:
            return "explore_loop"
        user_text = state["artifacts"].get("user_text", "")
        if _needs_web_research(user_text) and not state["artifacts"].get("web_research_done"):
            return "research"
        return "think_briefly"

    async def research(state: ExplorePlannerState) -> dict:
        _check_step_limit(state)
        user_text = state["artifacts"].get("user_text", "")
        query = _web_search_query(user_text)
        web_refs = await _invoke_web_search(tools, run, query)
        for ref in web_refs[:2]:
            url = ref.get("url")
            if not url:
                continue
            try:
                outcome = await tools.invoke(
                    "fetch_url",
                    {"url": url},
                    run_id=run.id,
                    agent_id=run.agent_id,
                )
                summary = outcome["result"].get("summary", "")
                if summary:
                    ref["snippet"] = summary[:400]
            except Exception:
                continue
        return {
            "messages": state["messages"],
            "artifacts": {
                **state["artifacts"],
                "web_references": web_refs,
                "web_research_done": True,
            },
            "step_index": state.get("step_index", 0) + 1,
        }

    async def think_briefly(state: ExplorePlannerState) -> dict:
        _check_step_limit(state)
        user_text = state["artifacts"].get("user_text", "")
        refs = state["artifacts"].get("references", [])
        files_read: dict = state["artifacts"].get("files_read", {})
        context_lines = []
        for path, content in list(files_read.items())[:5]:
            context_lines.append(f"### {path}\n{content[:2000]}")
        context = "\n\n".join(context_lines) or "(no files read)"
        use_mock = os.environ.get("USE_MOCK_PROVIDER", "").lower() in ("1", "true", "yes")
        if use_mock:
            brief = f"Explored {len(refs)} file(s) for: {user_text[:120]}"
        else:
            brief = await provider.complete(
                [
                    {"role": "system", "content": EXPLORE_PLANNER_SYSTEM},
                    {
                        "role": "user",
                        "content": (
                            f"Task: {user_text}\n\nExplored files:\n{context}\n\n"
                            "Write a 2–4 sentence brief of what you learned."
                        ),
                    },
                ]
            )
        return {
            "messages": state["messages"],
            "artifacts": {**state["artifacts"], "think_brief": brief},
            "step_index": state.get("step_index", 0) + 1,
        }

    async def propose_plan(state: ExplorePlannerState) -> dict:
        _check_step_limit(state)
        user_text = state["artifacts"].get("user_text", "")
        brief = state["artifacts"].get("think_brief", "")
        references = state["artifacts"].get("references", [])
        title = user_text.strip().split("\n")[0][:80] or "Implementation plan"
        use_mock = os.environ.get("USE_MOCK_PROVIDER", "").lower() in ("1", "true", "yes")
        if use_mock:
            plan_md = _mock_plan_markdown(title, references, user_text)
        else:
            refs = _format_references(references)
            web_block = _format_web_references(
                state["artifacts"].get("web_references", []),
            )
            plan_md = await provider.complete(
                [
                    {"role": "system", "content": EXPLORE_PLANNER_SYSTEM},
                    {
                        "role": "user",
                        "content": (
                            f"Task: {user_text}\n\nBrief:\n{brief}\n\n"
                            f"References:\n{refs}\n"
                            f"{web_block}\n\n"
                            "Produce final markdown plan:\n"
                            "# Plan: {title}\n## Summary\n...\n## Steps\n- [ ] ...\n## References\n- path"
                        ),
                    },
                ]
            )
            if "# Plan:" not in plan_md:
                plan_md = _mock_plan_markdown(title, references, user_text)
        return {
            "messages": state["messages"],
            "artifacts": {
                **state["artifacts"],
                "plan_title": title,
                "plan_markdown": plan_md,
            },
            "step_index": state.get("step_index", 0) + 1,
        }

    async def write_plan(state: ExplorePlannerState) -> dict:
        _check_step_limit(state)
        user_text = state["artifacts"].get("user_text", "")
        title = state["artifacts"].get("plan_title", "Implementation plan")
        references = state["artifacts"].get("references", [])
        plan_md = state["artifacts"].get("plan_markdown", "")
        if not plan_md.strip() or "# Plan:" not in plan_md:
            plan_md = _mock_plan_markdown(title, references, user_text)
        try:
            outcome = await tools.invoke(
                "write_plan_file",
                {"title": title, "content": plan_md, "run_id": run.id},
                run_id=run.id,
                agent_id=run.agent_id,
            )
            result = outcome.get("result", {})
            plan_id = ""
            if isinstance(result, dict):
                meta = result.get("meta") or {}
                plan_id = meta.get("id", "")
            assistant_msg = (
                f"Plan saved to `.idepus/plans/{plan_id}.md`.\n\n{plan_md[:4000]}"
                if plan_id
                else plan_md[:4000]
            )
            return {
                "messages": [
                    *state["messages"],
                    {"role": "assistant", "content": assistant_msg},
                ],
                "artifacts": {**state["artifacts"], "plan_result": result},
                "step_index": state.get("step_index", 0) + 1,
            }
        except Exception as exc:
            err = str(exc)
            assistant_msg = (
                f"{plan_md}\n\n---\n"
                f"*(Plan could not be saved to disk: {err[:300]}. "
                "Use Save in the plan editor.)*"
            )
            return {
                "messages": [
                    *state["messages"],
                    {"role": "assistant", "content": assistant_msg},
                ],
                "artifacts": {
                    **state["artifacts"],
                    "plan_save_error": err,
                    "plan_markdown": plan_md,
                },
                "step_index": state.get("step_index", 0) + 1,
            }

    graph = StateGraph(ExplorePlannerState)
    graph.add_node("gather_context", gather_context)
    graph.add_node("explore_loop", explore_loop)
    graph.add_node("research", research)
    graph.add_node("think_briefly", think_briefly)
    graph.add_node("propose_plan", propose_plan)
    graph.add_node("write_plan", write_plan)
    graph.set_entry_point("gather_context")
    graph.add_edge("gather_context", "explore_loop")
    graph.add_conditional_edges(
        "explore_loop",
        route_after_explore,
        {
            "explore_loop": "explore_loop",
            "research": "research",
            "think_briefly": "think_briefly",
        },
    )
    graph.add_edge("research", "think_briefly")
    graph.add_edge("think_briefly", "propose_plan")
    graph.add_edge("propose_plan", "write_plan")
    graph.add_edge("write_plan", END)
    return graph.compile(checkpointer=checkpointer)


register_plugin_agent("explore-planner", build_explore_planner_graph)


LINT_FIX_SYSTEM = """You fix compile and linter errors from terminal output.
Use SEARCH/REPLACE blocks only. Read affected files before editing.

<<<<<<< SEARCH
exact old text
=======
new text
>>>>>>> REPLACE"""


def _extract_affected_paths(text: str) -> list[str]:
    paths: list[str] = []
    marker = "Affected files:"
    if marker in text:
        tail = text.split(marker, 1)[1].split("\n", 2)[0]
        for part in tail.split(","):
            cleaned = part.strip().strip("()")
            if cleaned and cleaned != "(none parsed — use terminal output)":
                paths.append(cleaned.replace("\\", "/"))
    ext_group = "|".join(FILE_EXTENSIONS)
    for match in re.finditer(rf"([\w./-]+\.(?:{ext_group}))(?::\d+)?", text, re.I):
        path = match.group(1).replace("\\", "/")
        if path not in paths:
            paths.append(path)
    return paths[:5]


class LintFixState(TypedDict):
    messages: list[dict]
    artifacts: dict
    step_index: int


def build_lint_fix_graph(
    provider: ProviderPort,
    tools: ToolExecutorPort | None = None,
    run: Run | None = None,
    *,
    checkpointer: BaseCheckpointSaver | None = None,
    replay_ctx: ReplayContext | None = None,
):
    if tools is None or run is None:
        raise ValueError("lint-fix requires tools and run")

    max_steps = get_max_graph_steps()
    ctx = replay_ctx or ReplayContext()

    def _check_step_limit(state: LintFixState) -> None:
        if state.get("step_index", 0) >= max_steps:
            raise GraphStepLimitError()

    async def gather(state: LintFixState) -> dict:
        _check_step_limit(state)
        user_text = run.input_text or state["messages"][-1]["content"]
        candidates = _extract_affected_paths(user_text)
        files: dict[str, str] = {}
        primary = "."

        for path in candidates:
            try:
                outcome = await tools.invoke(
                    "read_file",
                    {"path": path},
                    run_id=run.id,
                    agent_id=run.agent_id,
                )
                content = outcome["result"].get("content", "")
                if content and not content.startswith("Workspace listing:"):
                    files[path] = content
                    if primary == ".":
                        primary = path
            except Exception:
                continue

        if not files:
            list_outcome = await tools.invoke(
                "list_dir",
                {"path": "", "recursive": False},
                run_id=run.id,
                agent_id=run.agent_id,
            )
            entries = list_outcome["result"].get("entries", [])
            listing = "\n".join(
                f"- {e.get('name', '?')}{'/' if e.get('is_dir') else ''}"
                for e in entries[:40]
            )
            files["."] = f"Workspace listing:\n{listing}"
            primary = "."

        return {
            "messages": state["messages"],
            "artifacts": {
                "path": primary,
                "content": files.get(primary, ""),
                "files": files,
                "terminal_output": user_text,
            },
            "step_index": state.get("step_index", 0) + 1,
        }

    async def propose_patch(state: LintFixState) -> dict:
        _check_step_limit(state)
        path = state["artifacts"]["path"]
        content = state["artifacts"]["content"]
        terminal_output = state["artifacts"]["terminal_output"]
        user_text = run.input_text or ""
        task_text = _task_text(user_text)
        target_block = _format_target_files_prompt(user_text)
        patch_text = await provider.complete(
            [
                {"role": "system", "content": LINT_FIX_SYSTEM},
                {
                    "role": "user",
                    "content": (
                        f"{target_block}Terminal output:\n{terminal_output[:12000]}\n\n"
                        f"File: {path}\n\nCurrent content:\n{content[:12000]}"
                    ),
                },
            ]
        )
        resolved, extra_messages, patch_failed = _finalize_patch_text(
            patch_text,
            content,
            task_text,
            path=path,
        )
        artifacts = {**state["artifacts"], "patch_failed": patch_failed}
        if resolved is not None:
            artifacts["raw_patch"] = resolved
        return {
            "messages": [*state["messages"], *extra_messages],
            "artifacts": artifacts,
            "step_index": state.get("step_index", 0) + 1,
        }

    def route_after_lint_propose(state: LintFixState) -> str:
        if state["artifacts"].get("patch_failed"):
            return "end"
        return "verify_shadow"

    async def verify_shadow(state: LintFixState) -> dict:
        _check_step_limit(state)
        path = state["artifacts"]["path"]
        raw_patch = state["artifacts"]["raw_patch"]
        content = state["artifacts"]["content"]
        try:
            outcome = await tools.invoke(
                "shadow_verify",
                {
                    "path": path,
                    "raw_patch": raw_patch,
                    "file_content": content,
                },
                run_id=run.id,
                agent_id=run.agent_id,
            )
            result = outcome.get("result", {})
            if not result.get("passed"):
                summary = result.get("stderr_summary") or "shadow verify failed"
                return {
                    "messages": [
                        *state["messages"],
                        {"role": "assistant", "content": f"Shadow test failed: {summary}"},
                    ],
                    "artifacts": {**state["artifacts"], "shadow_failed": True},
                    "step_index": state.get("step_index", 0) + 1,
                }
        except Exception as exc:
            return {
                "messages": [
                    *state["messages"],
                    {"role": "assistant", "content": f"Shadow verify error: {exc}"},
                ],
                "artifacts": {**state["artifacts"], "shadow_failed": True},
                "step_index": state.get("step_index", 0) + 1,
            }
        return {
            "messages": state["messages"],
            "artifacts": {**state["artifacts"], "shadow_failed": False},
            "step_index": state.get("step_index", 0) + 1,
        }

    def route_after_shadow_lint(state: LintFixState) -> str:
        if state["artifacts"].get("shadow_failed"):
            return "end"
        return "apply"

    async def apply(state: LintFixState) -> dict:
        _check_step_limit(state)
        path = state["artifacts"]["path"]
        raw_patch = state["artifacts"]["raw_patch"]
        content = state["artifacts"]["content"]
        outcome = await invoke_tool_with_hitl(
            "apply_patch",
            {"path": path, "raw_patch": raw_patch, "file_content": content},
            tools=tools,
            run=run,
            node="apply",
            replay_ctx=ctx,
            graph="lint-fix",
        )
        result = outcome.get("result", {})
        try:
            await tools.invoke(
                "run_linter",
                {"path": path},
                run_id=run.id,
                agent_id=run.agent_id,
            )
        except Exception:
            pass
        summary = f"Applied lint fix to {path}: {result}"
        return {
            "messages": [
                *state["messages"],
                {"role": "assistant", "content": summary},
            ],
            "artifacts": {**state["artifacts"], "apply_result": result},
            "step_index": state.get("step_index", 0) + 1,
        }

    graph = StateGraph(LintFixState)
    graph.add_node("gather", gather)
    graph.add_node("propose_patch", propose_patch)
    graph.add_node("verify_shadow", verify_shadow)
    graph.add_node("apply", apply)
    graph.set_entry_point("gather")
    graph.add_edge("gather", "propose_patch")
    graph.add_conditional_edges(
        "propose_patch",
        route_after_lint_propose,
        {"verify_shadow": "verify_shadow", "end": END},
    )
    graph.add_conditional_edges(
        "verify_shadow",
        route_after_shadow_lint,
        {"apply": "apply", "end": END},
    )
    graph.add_edge("apply", END)
    return graph.compile(checkpointer=checkpointer)


register_plugin_agent("lint-fix", build_lint_fix_graph)


MULTI_FILE_SYSTEM = """You edit one or more files using SEARCH/REPLACE blocks.
Group output by file:

### FILE: path/relative/to/workspace
<<<<<<< SEARCH
exact old text
=======
new text
>>>>>>> REPLACE

No markdown fences outside blocks."""


def _parse_multi_file_patches(text: str) -> dict[str, str]:
    patches: dict[str, str] = {}
    parts = re.split(r"(?m)^### FILE:\s*(\S+)\s*$", text)
    if len(parts) < 3:
        return patches
    # parts[0] is preamble; then pairs of (path, body)
    idx = 1
    while idx + 1 < len(parts):
        path = parts[idx].strip().replace("\\", "/")
        body = parts[idx + 1].strip()
        if path and _is_valid_patch_text(body):
            patches[path] = body
        idx += 2
    return patches


class MultiFileState(TypedDict):
    messages: list[dict]
    artifacts: dict
    step_index: int


def build_multi_file_editor_graph(
    provider: ProviderPort,
    tools: ToolExecutorPort | None = None,
    run: Run | None = None,
    *,
    checkpointer: BaseCheckpointSaver | None = None,
    replay_ctx: ReplayContext | None = None,
):
    if tools is None or run is None:
        raise ValueError("multi-file-editor requires tools and run")

    max_steps = max(get_max_graph_steps(), MULTI_FILE_STEP_BUDGET)
    ctx = replay_ctx or ReplayContext()

    def _check_step_limit(state: MultiFileState) -> None:
        if state.get("step_index", 0) >= max_steps:
            raise GraphStepLimitError()

    async def gather(state: MultiFileState) -> dict:
        _check_step_limit(state)
        user_text = run.input_text or state["messages"][-1]["content"]
        hits: list = []
        try:
            outcome = await tools.invoke(
                "search_codebase",
                {"query": _search_query_for_gather(user_text), "max_hits": 8},
                run_id=run.id,
                agent_id=run.agent_id,
            )
            hits = outcome["result"].get("hits", [])
        except Exception:
            hits = []

        declared = _extract_declared_target_files(user_text)
        files: dict[str, str] = {}
        if declared:
            for path in declared:
                resolved = await _find_declared_path(path, tools, run)
                files[resolved[0]] = resolved[1]
        else:
            candidates = await _collect_path_candidates(user_text, hits, tools, run)
            for path in candidates[:20]:
                resolved = await _read_file_or_empty(path, tools, run)
                if resolved is not None and resolved[1]:
                    files[resolved[0]] = resolved[1]

            if not files:
                path, content = await _resolve_target_file(user_text, hits, tools, run)
                if path not in (".", ""):
                    files[path] = content

        file_order = list(files.keys())[:20]
        return {
            "messages": state["messages"],
            "artifacts": {
                "files": files,
                "file_order": file_order,
                "patches": {},
                "queue_index": 0,
                "shadow_failed": {},
                "apply_results": {},
            },
            "step_index": state.get("step_index", 0) + 1,
        }

    async def propose_all_patches(state: MultiFileState) -> dict:
        _check_step_limit(state)
        files: dict[str, str] = state["artifacts"].get("files", {})
        file_order: list[str] = state["artifacts"].get("file_order", [])
        user_text = run.input_text or ""
        task_text = _task_text(user_text)

        if not file_order:
            return {
                "messages": [
                    *state["messages"],
                    {"role": "assistant", "content": "No target files found for this task."},
                ],
                "artifacts": {**state["artifacts"], "patches": {}, "file_order": []},
                "step_index": state.get("step_index", 0) + 1,
            }

        file_blocks = []
        for path in file_order:
            content = files.get(path, "")
            file_blocks.append(
                f"### FILE: {path}\nCurrent content:\n{content[:8000]}"
            )
        bundle = "\n\n".join(file_blocks)
        target_block = _format_target_files_prompt(user_text)

        patch_text = await provider.complete(
            [
                {"role": "system", "content": MULTI_FILE_SYSTEM},
                {
                    "role": "user",
                    "content": f"{target_block}Task: {task_text}\n\n{bundle}",
                },
            ]
        )
        patches = _parse_multi_file_patches(patch_text)
        extra_messages: list[dict] = []
        patch_failed = False
        if _use_mock_provider() or not patches:
            if _use_mock_provider():
                extra_messages.append({
                    "role": "assistant",
                    "content": (
                        "[Mock LLM mode] Patches synthesized locally — add API keys "
                        "and reload Aicery for real edits."
                    ),
                })
                patches = {}
                for path in file_order:
                    if path in (".", ""):
                        continue
                    content = files.get(path, "")
                    patches[path] = _mock_patch_for_content(content, task_text)
            else:
                preview = patch_text.strip().replace("\n", " ")[:240]
                extra_messages.append({
                    "role": "assistant",
                    "content": (
                        "LLM did not return valid multi-file SEARCH/REPLACE patches. "
                        f"Response preview: {preview}"
                    ),
                })
                patch_failed = True
                patches = {}

        ordered = [p for p in file_order if p in patches]
        return {
            "messages": [*state["messages"], *extra_messages],
            "artifacts": {
                **state["artifacts"],
                "patches": patches,
                "file_order": ordered,
                "queue_index": 0,
                "patch_failed": patch_failed,
            },
            "step_index": state.get("step_index", 0) + 1,
        }

    def route_after_propose_all(state: MultiFileState) -> str:
        if state["artifacts"].get("patch_failed"):
            return "end"
        return "process_file"

    async def process_file(state: MultiFileState) -> dict:
        _check_step_limit(state)
        file_order: list[str] = state["artifacts"].get("file_order", [])
        queue_index: int = state["artifacts"].get("queue_index", 0)
        files: dict[str, str] = state["artifacts"].get("files", {})
        patches: dict[str, str] = state["artifacts"].get("patches", {})
        shadow_failed: dict[str, bool] = dict(state["artifacts"].get("shadow_failed", {}))
        apply_results: dict = dict(state["artifacts"].get("apply_results", {}))

        if queue_index >= len(file_order):
            return {"messages": state["messages"], "artifacts": state["artifacts"], "step_index": state.get("step_index", 0)}

        path = file_order[queue_index]
        raw_patch = patches.get(path, "")
        content = files.get(path, "")

        if not raw_patch or path in (".", ""):
            shadow_failed[path] = True
            return {
                "messages": state["messages"],
                "artifacts": {
                    **state["artifacts"],
                    "shadow_failed": shadow_failed,
                    "queue_index": queue_index + 1,
                },
                "step_index": state.get("step_index", 0) + 1,
            }

        try:
            outcome = await tools.invoke(
                "shadow_verify",
                {
                    "path": path,
                    "raw_patch": raw_patch,
                    "file_content": content,
                },
                run_id=run.id,
                agent_id=run.agent_id,
            )
            result = outcome.get("result", {})
            if not result.get("passed"):
                shadow_failed[path] = True
                return {
                    "messages": state["messages"],
                    "artifacts": {
                        **state["artifacts"],
                        "shadow_failed": shadow_failed,
                        "queue_index": queue_index + 1,
                    },
                    "step_index": state.get("step_index", 0) + 1,
                }
        except Exception:
            shadow_failed[path] = True
            return {
                "messages": state["messages"],
                "artifacts": {
                    **state["artifacts"],
                    "shadow_failed": shadow_failed,
                    "queue_index": queue_index + 1,
                },
                "step_index": state.get("step_index", 0) + 1,
            }

        outcome = await invoke_tool_with_hitl(
            "apply_patch",
            {"path": path, "raw_patch": raw_patch, "file_content": content},
            tools=tools,
            run=run,
            node="apply",
            replay_ctx=ctx,
            graph="multi-file-editor",
        )
        apply_results[path] = outcome.get("result", {})
        return {
            "messages": state["messages"],
            "artifacts": {
                **state["artifacts"],
                "shadow_failed": shadow_failed,
                "apply_results": apply_results,
                "queue_index": queue_index + 1,
            },
            "step_index": state.get("step_index", 0) + 1,
        }

    def route_after_process(state: MultiFileState) -> str:
        file_order: list[str] = state["artifacts"].get("file_order", [])
        queue_index: int = state["artifacts"].get("queue_index", 0)
        if queue_index < len(file_order):
            return "process_file"
        return "summarize"

    async def summarize(state: MultiFileState) -> dict:
        _check_step_limit(state)
        file_order: list[str] = state["artifacts"].get("file_order", [])
        shadow_failed: dict[str, bool] = state["artifacts"].get("shadow_failed", {})
        apply_results: dict = state["artifacts"].get("apply_results", {})
        applied = list(apply_results.keys())
        failed = [p for p in file_order if shadow_failed.get(p)]
        skipped = [p for p in file_order if p not in applied and p not in failed]
        total = len(file_order)
        summary = (
            f"Multi-file run complete. Applied {len(applied)}/{total} files, "
            f"shadow failed: {len(failed)}, skipped: {len(skipped)}."
        )
        if applied:
            summary += "\nApplied: " + ", ".join(applied)
        if failed:
            summary += "\nShadow failed: " + ", ".join(failed)
        return {
            "messages": [
                *state["messages"],
                {"role": "assistant", "content": summary},
            ],
            "artifacts": state["artifacts"],
            "step_index": state.get("step_index", 0) + 1,
        }

    graph = StateGraph(MultiFileState)
    graph.add_node("gather", gather)
    graph.add_node("propose_all_patches", propose_all_patches)
    graph.add_node("process_file", process_file)
    graph.add_node("summarize", summarize)
    graph.set_entry_point("gather")
    graph.add_edge("gather", "propose_all_patches")
    graph.add_conditional_edges(
        "propose_all_patches",
        route_after_propose_all,
        {"process_file": "process_file", "end": END},
    )
    graph.add_conditional_edges(
        "process_file",
        route_after_process,
        {"process_file": "process_file", "summarize": "summarize"},
    )
    graph.add_edge("summarize", END)
    return graph.compile(checkpointer=checkpointer)


register_plugin_agent("multi-file-editor", build_multi_file_editor_graph)
