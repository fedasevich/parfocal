import json
import tempfile
import unittest
from pathlib import Path

from board import (
    ROOT,
    Active,
    check,
    load,
    parse_active,
    parse_depends,
    readable_path,
    render_static,
    tree_lines,
    write_active,
)

BACKLOG = """# Backlog

## Milestones

| Milestone | Meaning | Gate |
| --- | --- | --- |
| M0 Stack decided | Every slot closed | ADRs |
| M1 Walking skeleton | Log in | E2E |

## Epic index

| # | ID | Epic | Milestone |
| --- | --- | --- | --- |
| 00 | STACK | Stack decisions | M0 |
| 01 | SKEL | Walking skeleton | M0 to M1 |

---

## 00 STACK · Stack decisions

### Frontend

- [x] STACK-001 · Build tool
  Done when a spike passes.

- [ ] STACK-002 · Routing
  Done when typed.
  Depends on STACK-001.

- [ ] STACK-003 · Licensing (on hold)
  On hold.

---

## 01 SKEL · Walking skeleton

- [ ] SKEL-001 · Staging
  Depends on STACK-002 and STACK-003. Refs doc 1.

- [ ] SKEL-002 · Screens
  Depends on SKEL-001 and the final UI shell.

- [ ] SKEL-003 · Retro
  Done when written.

## Later epics

- Something later.
"""

LOG = """# Log

## 2026-10-15

- STACK-002 (routing) started.

## 2026-10-14

- STACK-001 (build tool) done, see SKEL-001 later.
"""

README = """# Docs

## Where we are now

All good.

## Next up

1. SKEL-001.

## Index
"""

ADR = """# 0001. Vite

- Date: 2026-10-06
- Status: Accepted
- Backlog: STACK-001
"""


class BoardTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        docs = self.root / "docs"
        (docs / "adr").mkdir(parents=True)
        (docs / "BACKLOG.md").write_text(BACKLOG)
        (docs / "log.md").write_text(LOG)
        (docs / "README.md").write_text(README)
        (docs / "adr" / "0001-vite.md").write_text(ADR)

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def claim(self, task_id: str, status: str, by: str = "agent") -> None:
        write_active(self.root, task_id, Active(status, by=by, since="2026-10-15"))

    def test_parses_epics_milestones_and_tasks(self) -> None:
        board = load(self.root)
        self.assertEqual([epic.id for epic in board.epics], ["STACK", "SKEL"])
        self.assertEqual(board.epics[1].milestone, "M0 to M1")
        self.assertEqual([m["id"] for m in board.milestones], ["M0", "M1"])
        self.assertEqual(
            list(board.tasks),
            [f"STACK-00{n}" for n in (1, 2, 3)] + [f"SKEL-00{n}" for n in (1, 2, 3)],
        )
        first = board.tasks["STACK-001"]
        self.assertTrue(first.done)
        self.assertEqual(first.group, "Frontend")
        self.assertEqual(first.body, "Done when a spike passes.")
        self.assertEqual(board.tasks["SKEL-001"].group, "")

    def test_dependencies_and_dependents(self) -> None:
        tasks = load(self.root).tasks
        self.assertEqual(tasks["SKEL-001"].deps, ["STACK-002", "STACK-003"])
        self.assertEqual(tasks["STACK-002"].dependents, ["SKEL-001"])
        self.assertEqual(tasks["SKEL-002"].dep_note, "Depends on SKEL-001 and the final UI shell.")
        self.assertEqual(tasks["SKEL-001"].dep_note, "")

    def test_parse_depends_across_lines_and_sentences(self) -> None:
        deps, note = parse_depends("Depends on A-001,\nB-002 and C-003. Refs D-004.")
        self.assertEqual(deps, ["A-001", "B-002", "C-003"])
        self.assertEqual(note, "")
        deps, note = parse_depends("Depends on M5.")
        self.assertEqual(deps, [])
        self.assertEqual(note, "Depends on M5.")

    def test_status_resolution(self) -> None:
        tasks = load(self.root).tasks
        self.assertEqual(tasks["STACK-001"].status, "done")
        self.assertEqual(tasks["STACK-002"].status, "ready")
        self.assertEqual(tasks["STACK-003"].status, "on-hold")
        self.assertEqual(tasks["SKEL-001"].status, "waiting")
        self.assertEqual(tasks["SKEL-003"].status, "ready")

    def test_claim_files_set_status_until_ticked(self) -> None:
        self.claim("STACK-002", "in-progress")
        self.claim("SKEL-003", "review")
        self.claim("STACK-001", "in-progress")
        tasks = load(self.root).tasks
        self.assertEqual(tasks["STACK-002"].status, "in-progress")
        active = tasks["STACK-002"].active
        assert active is not None
        self.assertEqual(active.by, "agent")
        self.assertEqual(tasks["SKEL-003"].status, "review")
        self.assertEqual(tasks["STACK-001"].status, "done")

    def test_claim_file_round_trip(self) -> None:
        active = Active("blocked", "owner", "b", "2026-10-15", "needs keys", "Longer\n\ntext.")
        path = write_active(self.root, "SKEL-003", active)
        self.assertEqual(parse_active(path.read_text()), active)

    def test_links_docs_and_log(self) -> None:
        board = load(self.root)
        self.assertEqual(board.tasks["STACK-001"].docs, ["docs/adr/0001-vite.md"])
        adr = next(doc for doc in board.docs if doc.kind == "adr")
        self.assertEqual((adr.status, adr.date), ("Accepted", "2026-10-06"))
        self.assertEqual(
            [entry.ids for entry in board.log], [["STACK-002"], ["STACK-001", "SKEL-001"]]
        )
        self.assertEqual(board.overview["Next up"], "1. SKEL-001.")

    def test_trees_go_both_ways_and_mark_repeats(self) -> None:
        tasks = load(self.root).tasks
        self.assertEqual(
            tree_lines(tasks, "SKEL-002", down=False),
            [
                "SKEL-002 [waiting] Screens",
                "  SKEL-001 [waiting] Staging",
                "    STACK-002 [ready] Routing",
                "      STACK-001 [done] Build tool",
                "    STACK-003 [on-hold] Licensing (on hold)",
            ],
        )
        self.assertEqual(
            tree_lines(tasks, "STACK-001", down=True),
            [
                "STACK-001 [done] Build tool",
                "  STACK-002 [ready] Routing",
                "    SKEL-001 [waiting] Staging",
                "      SKEL-002 [waiting] Screens",
            ],
        )

    def test_check_passes_a_clean_board(self) -> None:
        self.assertEqual(check(self.root), [])

    def test_check_reports_bad_claims_and_dependencies(self) -> None:
        backlog = self.root / "docs" / "BACKLOG.md"
        backlog.write_text(
            BACKLOG.replace("Done when written.", "Depends on SKEL-009.").replace(
                "Done when typed.", "Done when typed. Depends on SKEL-001."
            )
        )
        self.claim("STACK-001", "in-progress")
        self.claim("NOPE-001", "in-progress")
        self.claim("SKEL-003", "started")
        problems = check(self.root)
        self.assertIn("SKEL-003: depends on unknown task SKEL-009", problems)
        self.assertIn(
            "docs/board/active/STACK-001.md: STACK-001 is ticked, delete its board file", problems
        )
        self.assertIn("docs/board/active/NOPE-001.md: no task NOPE-001 in the backlog", problems)
        self.assertIn("docs/board/active/SKEL-003.md: unknown status 'started'", problems)
        self.assertTrue(any(problem.startswith("dependency cycle") for problem in problems))

    def test_file_reads_stay_inside_docs(self) -> None:
        (self.root / "secret.md").write_text("no")
        self.assertIsNotNone(readable_path(self.root, "docs/adr/0001-vite.md"))
        self.assertIsNone(readable_path(self.root, "docs/../secret.md"))
        self.assertIsNone(readable_path(self.root, "/etc/passwd"))
        self.assertIsNone(readable_path(self.root, "docs/missing.md"))

    def test_static_page_embeds_board_and_files(self) -> None:
        page = render_static(load(self.root), self.root)
        self.assertNotIn("/*__STATIC__*/null", page)
        start = page.index("const STATIC = ") + len("const STATIC = ")
        payload = json.loads(page[start : page.index(";\n", start)].replace("<\\/", "</"))
        self.assertEqual(len(payload["board"]["tasks"]), 6)
        self.assertIn("docs/adr/0001-vite.md", payload["files"])

    def test_repository_board_is_consistent(self) -> None:
        self.assertEqual(check(ROOT), [])


if __name__ == "__main__":
    unittest.main()
