import tempfile
import unittest
from pathlib import Path

from guard_images import allow_image


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


if __name__ == "__main__":
    unittest.main()
