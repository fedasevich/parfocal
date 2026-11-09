import unittest

from load.target import TargetRefusedError, checked_target


class LoadTargetTest(unittest.TestCase):
    def test_local_and_staging_targets_pass(self) -> None:
        for url in (
            "http://localhost:8765",
            "http://127.0.0.1:5199/",
            "https://staging.parfocal.eu",
            "wss://staging-edge.parfocal.eu",
            "https://parfocal--staging-api.modal.run",
        ):
            with self.subTest(url=url):
                self.assertEqual(checked_target(url), url.rstrip("/"))

    def test_production_and_unknown_targets_are_refused(self) -> None:
        for url in (
            None,
            "",
            "https://parfocal.eu",
            "https://app.parfocal.eu",
            "https://parfocal--main-api.modal.run",
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
            checked_target("https://app.parfocal.eu", "load.example.org")


if __name__ == "__main__":
    unittest.main()
