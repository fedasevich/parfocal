import unittest

from load.target import (
    CLOUD_SECONDS,
    CLOUD_USERS,
    LoadRefusedError,
    TargetRefusedError,
    check_cloud_load,
    checked_target,
    is_cloud,
)


class LoadTargetTest(unittest.TestCase):
    def test_local_and_production_targets_pass(self) -> None:
        for url in (
            "http://localhost:8765",
            "http://127.0.0.1:5199/",
            "https://app.parfocal.eu",
            "https://parfocal.eu/",
            "wss://app.parfocal.eu",
            "https://fedasevich--parfocal-api.modal.run",
        ):
            with self.subTest(url=url):
                self.assertEqual(checked_target(url), url.rstrip("/"))

    def test_unknown_and_malformed_targets_are_refused(self) -> None:
        for url in (
            None,
            "",
            "https://example.org",
            "https://parfocal.eu.example.org",
            "https://notparfocal.eu",
            "ftp://localhost",
            "localhost:8000",
        ):
            with self.subTest(url=url), self.assertRaises(TargetRefusedError):
                checked_target(url)

    def test_an_exact_allowed_host_passes(self) -> None:
        self.assertEqual(
            checked_target("https://load.example.org/", "load.example.org"),
            "https://load.example.org",
        )

    def test_the_allowed_host_does_not_cover_other_hosts(self) -> None:
        with self.assertRaises(TargetRefusedError):
            checked_target("https://other.example.org", "load.example.org")

    def test_only_local_hosts_are_not_cloud(self) -> None:
        self.assertFalse(is_cloud("http://localhost:8765"))
        self.assertFalse(is_cloud("http://[::1]:8765"))
        self.assertTrue(is_cloud("https://app.parfocal.eu"))

    def test_a_tiny_cloud_load_passes(self) -> None:
        check_cloud_load(CLOUD_USERS, CLOUD_SECONDS, headless=True, lifted=False)

    def test_a_cloud_load_past_the_caps_is_refused(self) -> None:
        for users, seconds, headless in (
            (CLOUD_USERS + 1, 30, True),
            (1, CLOUD_SECONDS + 1, True),
            (1, None, True),
            (1, 30, False),
        ):
            with (
                self.subTest(users=users, seconds=seconds, headless=headless),
                self.assertRaises(LoadRefusedError),
            ):
                check_cloud_load(users, seconds, headless, lifted=False)

    def test_lifting_the_limits_still_needs_headless_and_a_run_time(self) -> None:
        check_cloud_load(50, 600, headless=True, lifted=True)
        with self.assertRaises(LoadRefusedError):
            check_cloud_load(50, None, headless=True, lifted=True)
        with self.assertRaises(LoadRefusedError):
            check_cloud_load(50, 600, headless=False, lifted=True)


if __name__ == "__main__":
    unittest.main()
