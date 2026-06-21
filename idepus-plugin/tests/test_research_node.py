"""Tests for web research graph helpers."""
from __future__ import annotations

import sys
from pathlib import Path

_agents_dir = str(Path(__file__).resolve().parents[1] / "agents")
if _agents_dir not in sys.path:
    sys.path.insert(0, _agents_dir)

from graph import (  # noqa: E402
    _format_web_references,
    _needs_web_research,
    _web_search_query,
)


def test_needs_web_research_detects_breaking_changes():
    assert _needs_web_research("React 19 breaking changes?")
    assert not _needs_web_research("refactor auth module")


def test_web_search_query_uses_first_line():
    assert _web_search_query("line one\nline two") == "line one"


def test_format_web_references_markdown():
    text = _format_web_references(
        [{"title": "Docs", "url": "https://example.com", "snippet": "hello"}]
    )
    assert "## Web sources" in text
    assert "https://example.com" in text
