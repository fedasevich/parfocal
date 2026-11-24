import tempfile
import unittest
from pathlib import Path

from guard_big_docs import blocked


def bash(command: str) -> dict[str, object]:
    return {"tool_name": "Bash", "tool_input": {"command": command}}


class GuardTest(unittest.TestCase):
    def test_blocks_whole_reads_of_the_big_docs(self) -> None:
        for command in (
            "cat docs/BACKLOG.md",
            "cd /repo && head -80 docs/log.md",
            "sed -n '1,400p' docs/BACKLOG.md",
            "sed 's/a/b/' docs/log.md",
            "git status; less docs/BACKLOG.md",
        ):
            self.assertTrue(blocked(bash(command)), command)

    def test_allows_small_reads_writes_and_other_files(self) -> None:
        for command in (
            "grep -n 'PROTO-019' docs/BACKLOG.md",
            "sed -n '480,520p' docs/BACKLOG.md",
            "sed -i '' 's/- \\[ \\] X/- [x] X/' docs/BACKLOG.md",
            "cat docs/README.md",
            "cat docs/knowledge/log.md.bak",
            "python3 scripts/board.py show PROTO-019",
        ):
            self.assertFalse(blocked(bash(command)), command)

    def test_read_tool_needs_a_small_limit(self) -> None:
        path = "/repo/docs/BACKLOG.md"
        self.assertTrue(blocked({"tool_name": "Read", "tool_input": {"file_path": path}}))
        self.assertTrue(
            blocked({"tool_name": "Read", "tool_input": {"file_path": path, "limit": 900}})
        )
        self.assertFalse(
            blocked({"tool_name": "Read", "tool_input": {"file_path": path, "limit": 80}})
        )
        self.assertFalse(
            blocked({"tool_name": "Read", "tool_input": {"file_path": "/repo/AGENTS.md"}})
        )

    def test_blocks_whole_reads_of_result_files_over_20_kb(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            results = Path(folder) / "docs" / "results"
            results.mkdir(parents=True)
            (results / "big-walk.md").write_text("line\n" * 6000)
            (results / "small.md").write_text("line\n" * 20)
            big = "docs/results/big-walk.md"

            def bash(command: str) -> dict[str, object]:
                return {"tool_name": "Bash", "cwd": folder, "tool_input": {"command": command}}

            def read(path: str, **extra: object) -> dict[str, object]:
                return {
                    "tool_name": "Read",
                    "cwd": folder,
                    "tool_input": {"file_path": path, **extra},
                }

            self.assertTrue(blocked(bash(f"cat {big}")))
            self.assertTrue(blocked(read(str(results / "big-walk.md"))))
            self.assertFalse(blocked(bash(f"sed -n '1,60p' {big}")))
            self.assertFalse(blocked(bash(f"grep -n Finding {big}")))
            self.assertFalse(blocked(read(str(results / "big-walk.md"), limit=60)))
            self.assertFalse(blocked(bash("cat docs/results/small.md")))
            self.assertFalse(blocked(read(str(results / "small.md"))))


if __name__ == "__main__":
    unittest.main()
