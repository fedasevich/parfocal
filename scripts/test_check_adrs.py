import tempfile
import unittest
from pathlib import Path

from check_adrs import check

INDEX_HEADER = "| # | Decision | Status | Date |\n|---|---|---|---|\n"


def write_adr(adr_dir: Path, name: str, status_line: str | None) -> None:
    lines = ["# Title", "", "- Date: 2026-10-06"]
    if status_line is not None:
        lines.append(status_line)
    (adr_dir / name).write_text("\n".join(lines) + "\n")


def write_index(adr_dir: Path, numbers: list[str]) -> None:
    rows = "".join(f"| [{n}]({n}-x.md) | x | Accepted | 2026-10-06 |\n" for n in numbers)
    (adr_dir / "README.md").write_text(INDEX_HEADER + rows)


class CheckAdrsTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.adr_dir = Path(self.tmp.name)

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def test_valid_records_pass(self) -> None:
        write_adr(self.adr_dir, "0001-first.md", "- Status: Superseded by 0002")
        write_adr(self.adr_dir, "0002-second.md", "- Status: Accepted")
        write_index(self.adr_dir, ["0001", "0002"])
        self.assertEqual(check(self.adr_dir), [])

    def test_missing_status_fails(self) -> None:
        write_adr(self.adr_dir, "0001-first.md", None)
        write_index(self.adr_dir, ["0001"])
        self.assertEqual(
            check(self.adr_dir),
            ["0001-first.md: expected one '- Status:' line, found 0"],
        )

    def test_unknown_status_fails(self) -> None:
        write_adr(self.adr_dir, "0001-first.md", "- Status: Maybe")
        write_index(self.adr_dir, ["0001"])
        self.assertEqual(check(self.adr_dir), ["0001-first.md: unknown status 'Maybe'"])

    def test_superseded_by_missing_record_fails(self) -> None:
        write_adr(self.adr_dir, "0001-first.md", "- Status: Superseded by 0009")
        write_index(self.adr_dir, ["0001"])
        self.assertEqual(
            check(self.adr_dir),
            ["0001-first.md: superseded by missing record 0009"],
        )

    def test_record_missing_from_index_fails(self) -> None:
        write_adr(self.adr_dir, "0001-first.md", "- Status: Accepted")
        write_index(self.adr_dir, [])
        self.assertEqual(
            check(self.adr_dir),
            ["README.md: ADR 0001 is not listed in the index"],
        )

    def test_repository_records_pass(self) -> None:
        repo_adr_dir = Path(__file__).resolve().parent.parent / "docs" / "adr"
        self.assertEqual(check(repo_adr_dir), [])


if __name__ == "__main__":
    unittest.main()
