import tempfile
import unittest
from pathlib import Path

from guard_images import advice, allow_image

ROOT = Path(__file__).resolve().parent.parent
AGENT_FACING = (
    "AGENTS.md",
    "README.md",
    ".claude/agents/task-runner.md",
    "docs/knowledge/agent-workflow.md",
    "apps/web/e2e/shot.ts",
)


def read(path: str, agent: str = "a1") -> dict[str, object]:
    return {"tool_name": "Read", "agent_id": agent, "tool_input": {"file_path": path}}


class GuardImagesTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.counts = Path(self.tmp.name)

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def test_blocks_images_past_the_limit_per_agent(self) -> None:
        allowed = [allow_image(read(f"/tmp/shot-{n}.png"), self.counts, 3) for n in range(5)]
        self.assertEqual(allowed, [True, True, True, False, False])
        self.assertTrue(allow_image(read("/tmp/shot.PNG", agent="a2"), self.counts, 3))

    def test_ignores_files_that_are_not_images(self) -> None:
        for _ in range(5):
            self.assertTrue(allow_image(read("/repo/AGENTS.md"), self.counts, 1))
        bash: dict[str, object] = {
            "tool_name": "Bash",
            "agent_id": "a1",
            "tool_input": {"command": "ls *.png"},
        }
        self.assertTrue(allow_image(bash, self.counts, 0))

    def test_advice_points_at_no_mock_comparison(self) -> None:
        self.assertIn("--against", advice(5))
        self.assertNotIn("mock", advice(5).lower())

    def test_nothing_agents_read_compares_against_the_mock(self) -> None:
        banned = ("--mock", "against the mock", "with the mock", "mock scene")
        for name in AGENT_FACING:
            text = (ROOT / name).read_text().lower()
            for phrase in banned:
                self.assertNotIn(phrase, text, name)


if __name__ == "__main__":
    unittest.main()
