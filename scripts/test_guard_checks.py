import tempfile
import unittest
from pathlib import Path

from guard_checks import pause_message

FREE = {"verify": 3, "playwright": 10}


def bash(command: str, agent: str = "a1") -> dict[str, object]:
    return {"tool_name": "Bash", "agent_id": agent, "tool_input": {"command": command}}


class GuardChecksTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.counts = Path(self.tmp.name)

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def paused(self, command: str, agent: str = "a1") -> bool:
        return pause_message(bash(command, agent), self.counts, FREE) is not None

    def test_pauses_the_fourth_verify_once_then_lets_the_retry_run(self) -> None:
        verify = "bash scripts/verify-changed.sh 2>&1 | tail -40"
        outcomes = [self.paused(verify) for _ in range(6)]
        self.assertEqual(outcomes, [False, False, False, True, False, False])

    def test_pauses_again_after_three_more_verifies(self) -> None:
        verify = "bash scripts/verify-changed.sh"
        outcomes = [self.paused(verify) for _ in range(8)]
        self.assertEqual(outcomes, [False, False, False, True, False, False, False, True])

    def test_counts_each_agent_and_each_check_apart(self) -> None:
        for _ in range(3):
            self.assertFalse(self.paused("bash scripts/verify-changed.sh"))
        self.assertFalse(self.paused("bash scripts/verify-changed.sh", agent="a2"))
        self.assertFalse(self.paused("pnpm exec playwright test e2e/a.spec.ts"))
        self.assertTrue(self.paused("bash scripts/verify-changed.sh"))

    def test_pauses_the_eleventh_playwright_run(self) -> None:
        outcomes = [self.paused("npx playwright test e2e/a.spec.ts -g one") for _ in range(12)]
        self.assertEqual(outcomes, [False] * 10 + [True, False])

    def test_ignores_other_commands_and_tools(self) -> None:
        for _ in range(20):
            self.assertFalse(self.paused("uv run pytest apps/api/tests/test_a.py"))
        read: dict[str, object] = {
            "tool_name": "Read",
            "agent_id": "a1",
            "tool_input": {"file_path": "scripts/verify-changed.sh"},
        }
        for _ in range(20):
            self.assertIsNone(pause_message(read, self.counts, FREE))

    def test_the_message_names_the_count(self) -> None:
        for _ in range(3):
            self.paused("bash scripts/verify-changed.sh")
        message = pause_message(bash("bash scripts/verify-changed.sh"), self.counts, FREE)
        self.assertIn("3 times", message or "")


if __name__ == "__main__":
    unittest.main()
