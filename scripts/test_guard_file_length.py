import subprocess
import tempfile
import unittest
from pathlib import Path

from guard_file_length import EXCEPTIONS, LIMIT, checked, lengths, problems

LONG = "x = 1\n" * (LIMIT + 1)
PLANTED = {
    "apps/web/src/screen.tsx": LONG,
    "apps/web/src/short.ts": "x = 1\n",
    "apps/web/src/screen.test.ts": LONG,
    "apps/api/tests/test_big.py": LONG,
    "packages/api-client/src/generated/api.ts": LONG,
    "apps/web/src/route-tree.gen.ts": LONG,
    "apps/api/src/parfocal_api/old.py": LONG,
    "docs/long.md": LONG,
}


class GuardFileLengthTest(unittest.TestCase):
    def test_skips_tests_generated_code_and_docs(self) -> None:
        self.assertTrue(checked("apps/web/src/screen.tsx"))
        self.assertFalse(checked("apps/web/src/screen.test.ts"))
        self.assertFalse(checked("apps/api/tests/conftest.py"))
        self.assertFalse(checked("packages/api-client/src/generated/api.ts"))
        self.assertFalse(checked("docs/long.md"))

    def test_fails_on_new_long_files_and_stale_exceptions(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            subprocess.run(["git", "init", "-q"], cwd=root, check=True)
            for name, text in PLANTED.items():
                path = root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(text)
            found = problems(
                lengths(root),
                {"apps/api/src/parfocal_api/old.py", "apps/web/src/short.ts"},
            )
        self.assertEqual(len(found), 2)
        self.assertIn("apps/web/src/screen.tsx has", found[0])
        self.assertIn("apps/web/src/short.ts is no longer over", found[1])

    def test_the_repository_passes(self) -> None:
        root = Path(__file__).resolve().parent.parent
        self.assertEqual(problems(lengths(root), EXCEPTIONS), [])
