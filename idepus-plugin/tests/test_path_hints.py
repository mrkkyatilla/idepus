import os
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from agents.path_hints import (  # noqa: E402
    _extract_declared_target_files,
    _extract_filename_hint,
    _finalize_patch_text,
)


class PathHintTests(unittest.TestCase):
    def test_declared_target_files(self) -> None:
        text = "[Target files]\n- test.md\n- src/foo.ts\n\n[Task]\nhello"
        self.assertEqual(
            _extract_declared_target_files(text),
            ["test.md", "src/foo.ts"],
        )

    def test_scope_focus_hint(self) -> None:
        self.assertEqual(
            _extract_filename_hint("only focus on test"),
            "test.md",
        )

    def test_finalize_patch_rejects_invalid_llm(self) -> None:
        prev = os.environ.get("USE_MOCK_PROVIDER")
        os.environ["USE_MOCK_PROVIDER"] = "false"
        try:
            patch, messages, failed = _finalize_patch_text(
                "not a patch",
                "",
                "write hello",
                path="test.md",
            )
            self.assertIsNone(patch)
            self.assertTrue(failed)
            self.assertTrue(messages)
        finally:
            if prev is None:
                os.environ.pop("USE_MOCK_PROVIDER", None)
            else:
                os.environ["USE_MOCK_PROVIDER"] = prev


if __name__ == "__main__":
    unittest.main()
