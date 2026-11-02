import unittest

from guard_usage import touches_override, warning

NOW = 1_800_000_000.0


def latest(five_hour: float, weekly: float = 10.0, age: float = 60.0) -> dict[str, object]:
    return {
        "recorded_at": NOW - age,
        "rate_limits": {
            "five_hour": {"used_percentage": five_hour, "resets_at": NOW + 3600},
            "seven_day": {"used_percentage": weekly, "resets_at": "2027-01-01T00:00:00Z"},
        },
    }


EVENT: dict[str, object] = {"hook_event_name": "PostToolUse", "session_id": "s1"}


class GuardUsageTest(unittest.TestCase):
    def test_silent_below_the_first_band(self) -> None:
        self.assertIsNone(warning(EVENT, latest(79), {}, {}, NOW))

    def test_warns_once_per_band_then_every_call_from_95(self) -> None:
        warned: dict[str, int] = {}
        self.assertIn("getting high", warning(EVENT, latest(81), {}, warned, NOW) or "")
        self.assertIsNone(warning(EVENT, latest(85), {}, warned, NOW))
        self.assertIn("Wrap up", warning(EVENT, latest(91), {}, warned, NOW) or "")
        self.assertIsNone(warning(EVENT, latest(92), {}, warned, NOW))
        self.assertIn("Stop now", warning(EVENT, latest(95), {}, warned, NOW) or "")
        self.assertIn("Stop now", warning(EVENT, latest(96), {}, warned, NOW) or "")

    def test_weekly_limit_counts_too(self) -> None:
        self.assertIn("Wrap up", warning(EVENT, latest(20, weekly=93), {}, {}, NOW) or "")

    def test_override_silences_until_it_expires(self) -> None:
        self.assertIsNone(warning(EVENT, latest(99), {"until": NOW + 60}, {}, NOW))
        self.assertIn("Stop now", warning(EVENT, latest(99), {"until": NOW - 60}, {}, NOW) or "")

    def test_ignores_stale_or_missing_readings(self) -> None:
        self.assertIsNone(warning(EVENT, latest(99, age=3600), {}, {}, NOW))
        self.assertIsNone(warning(EVENT, {}, {}, {}, NOW))

    def test_stop_message_does_not_name_the_override_command(self) -> None:
        self.assertNotIn("guard_usage.py", warning(EVENT, latest(99), {}, {}, NOW) or "")

    def test_agents_cannot_touch_the_override(self) -> None:
        blocked = [
            {"command": "python3 scripts/guard_usage.py override 2"},
            {"command": "python3 guard_usage.py  override"},
            {"command": "echo '{}' > .claude/usage-override.json"},
            {"file_path": "/repo/.claude/usage-override.json", "content": "{}"},
        ]
        for tool_input in blocked:
            self.assertTrue(touches_override({"tool_input": tool_input}), tool_input)
        status = {"tool_input": {"command": "python3 scripts/guard_usage.py"}}
        self.assertFalse(touches_override(status))


if __name__ == "__main__":
    unittest.main()
