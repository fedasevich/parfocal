import subprocess
import tempfile
import unittest
from pathlib import Path

from guard_old_word import WORD, found

PLANTED = {
    "apps/web/src/screen.ts": f"const {WORD.title()} = 1\n",
    "apps/api/migrations/versions/0030_old.py": f'TABLE = "{WORD}s"\n',
    "apps/api/migrations/versions/0112_later.py": f'TABLE = "{WORD}s"\n',
    "docs/log.md": f"Renamed the {WORD} table.\n",
    "docs/adr/0300-new.md": f"An {WORD.upper()} again.\n",
    "apps/web/src/clean.ts": "const decision = 1\n",
}


class GuardOldWordTest(unittest.TestCase):
    def test_fails_on_new_uses_and_skips_the_history(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            subprocess.run(["git", "init", "-q"], cwd=root, check=True)
            for name, text in PLANTED.items():
                path = root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(text)
            hits = sorted(line.split(":", 1)[0] for line in found(root))
        self.assertEqual(
            hits,
            [
                "apps/api/migrations/versions/0112_later.py",
                "apps/web/src/screen.ts",
                "docs/adr/0300-new.md",
            ],
        )

    def test_the_repository_is_clean(self) -> None:
        self.assertEqual(found(Path(__file__).resolve().parent.parent), [])


if __name__ == "__main__":
    unittest.main()
