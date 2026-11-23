import json
import re
import tempfile
import unittest
from pathlib import Path

from study import charts, render, round4
from study.analysis import analyse, fixed, sus_score
from study.cli import PLACES, main
from study.load import read_csv, read_exports, read_json

FIXTURE = Path(__file__).resolve().parent / "fixtures" / "study-round-5-export.json"
DASHES = (chr(0x2013), chr(0x2014))


def fixture_analysis(**options):
    return analyse(read_exports([FIXTURE]), exclude={"p-pilt"}, **options)


class TaskTableTest(unittest.TestCase):
    def test_rows_match_the_fixture(self):
        rows = render.task_table(fixture_analysis())
        self.assertEqual(
            rows[0],
            [
                1,
                "Open the slide to review (open-case)",
                "Open a case",
                "3 of 3",
                0,
                "8.0",
                "6.0 to 10.0",
                "3.0",
                "2 to 4",
                1,
                "0.0",
                "6.7",
                "7.0",
                "6 to 7",
                "3 of 3",
                0,
            ],
        )
        self.assertEqual(
            rows[1],
            [
                2,
                "Answer four unsure cells (check-cells)",
                "Check 4 cells",
                "2 of 3",
                1,
                "40.0",
                "30.0 to 50.0",
                "12.0",
                "10 to 20",
                4,
                "1.0",
                "4.7",
                "5.0",
                "3 to 6",
                "1 of 3",
                0,
            ],
        )
        self.assertEqual(rows[2][2:6], ["new in round 5", "2 of 3", 1, "30.0"])

    def test_dry_runs_and_sessions_without_tasks_are_left_out(self):
        analysis = fixture_analysis()
        self.assertEqual(analysis.excluded, ["P-DRYY", "P-PILT"])
        self.assertEqual(analysis.without_tasks, ["P-OLD0"])
        self.assertEqual(analysis.overall.participants, 3)
        self.assertEqual(analysis.overall.attempts, 9)

    def test_moderator_scoring_replaces_the_app_success(self):
        analysis = fixture_analysis(
            scored={("P-CCCC", "queue-decision"): True, ("P-AAAA", "open-case"): False}
        )
        rows = render.task_table(analysis)
        self.assertEqual(rows[0][3], "2 of 3")
        self.assertEqual(rows[2][3], "3 of 3")
        self.assertIn("moderator-scored", analysis.success_source)
        self.assertIn("for 2 of 9 attempts", analysis.success_source)

    def test_a_scored_row_with_no_attempt_is_reported(self):
        analysis = fixture_analysis(scored={("P-ZZZZ", "open-case"): True})
        self.assertIn("for 0 of 9 attempts", analysis.success_source)
        self.assertEqual(
            analysis.warnings, ["The scored CSV row P-ZZZZ, open-case matches no included attempt"]
        )

    def test_the_more_complete_copy_of_a_session_wins(self):
        with tempfile.TemporaryDirectory() as folder:
            early = Path(folder) / "early.json"
            data = json.loads(FIXTURE.read_text(encoding="utf-8"))
            first = next(s for s in data["sessions"] if s["participant"] == "P-AAAA")
            first["tasks"] = first["tasks"][:1]
            first["final"] = None
            early.write_text(json.dumps([first]), encoding="utf-8")
            export = read_exports([early, FIXTURE])
        session = next(s for s in export.sessions if s.participant == "P-AAAA")
        self.assertEqual(len(session.attempts), 3)
        self.assertTrue(session.finished)


class SusTest(unittest.TestCase):
    def test_scores_per_participant_and_mean(self):
        analysis = fixture_analysis()
        self.assertEqual(
            render.sus_table(analysis),
            [
                ["P-AAAA", "s-p-aaaa", "100.0", "10 of 10", "recomputed from the ten answers"],
                ["P-BBBB", "s-p-bbbb", "75.0", "10 of 10", "recomputed from the ten answers"],
                ["P-CCCC", "s-p-cccc", "n/a", "9 of 10", "incomplete, not scored"],
            ],
        )
        self.assertEqual(analysis.mean_sus, 87.5)

    def test_scoring_and_rounding_follow_round_4(self):
        self.assertEqual(sus_score([5, 1] * 5), 100.0)
        self.assertEqual(sus_score([3] * 10), 50.0)
        self.assertEqual(fixed(83.75), "83.8")
        self.assertEqual(fixed(6.25), "6.3")

    def test_a_wrong_exported_score_is_recomputed_and_reported(self):
        export = read_exports([FIXTURE])
        export.sessions[0].sus_score = 90.0
        analysis = analyse(export, exclude={"P-PILT"})
        self.assertEqual(analysis.sus[0].score, 100.0)
        self.assertEqual(len(analysis.warnings), 1)


class ComparisonTest(unittest.TestCase):
    def test_round_4_is_quoted_with_its_source_beside_round_5(self):
        rows = {row[0]: row for row in render.comparison_table(fixture_analysis())}
        self.assertEqual(rows["Tasks completed"][1:4], ["40 of 40", round4.RESULTS, "7 of 9"])
        self.assertEqual(rows["Mean SEQ (1 to 7)"][1:4], ["6.4", round4.RESULTS, "5.0"])
        self.assertEqual(rows["Tasks rated 6 or 7"][1:4], ["35 of 40", round4.RESULTS, "4 of 9"])
        self.assertEqual(
            rows["Dead clicks, share of task clicks"][1:4],
            ["15% (42 of 277)", round4.MOVEMENT, "16% (11 of 70)"],
        )
        self.assertEqual(rows["Mean SUS"][1:4], ["83.8", round4.RESULTS, "87.5"])
        self.assertEqual(rows["SUS per participant"][1], "P1 100, P2 95, P3 80, P4 60")
        self.assertEqual(
            rows["Median time from reading a task to the first action"][1:4],
            ["4.8 s", round4.MOVEMENT, "not recorded in the export"],
        )
        self.assertEqual(rows["SUS in round 1"][1:3], ["52.5", round4.BEFORE_AFTER])
        for row in rows.values():
            self.assertTrue(row[2].startswith(round4.DECK))

    def test_round_4_figures_agree_with_each_other(self):
        scores = [score for _, score in round4.SUS_PER_PARTICIPANT]
        self.assertEqual(fixed(sum(scores) / len(scores)), round4.MEAN_SUS)
        seqs = [float(task.seq) for task in round4.TASK_FIGURES]
        self.assertEqual(fixed(sum(seqs) / len(seqs)), round4.MEAN_SEQ)
        self.assertEqual(fixed(100 * 42 / 277, 0) + "%", round4.DEAD_CLICK_SHARE)

    def test_per_task_table_lists_every_round_4_task_and_the_new_ones(self):
        rows = render.per_task_table(fixture_analysis())
        self.assertEqual(len(rows), 11)
        self.assertEqual(rows[0][1:5], ["5.9", "7.0", round4.PER_TASK, "8.0"])
        self.assertEqual(
            rows[-1][0:3],
            ["Settle a disagreement (queue-decision)", "new in round 5", "new in round 5"],
        )


class NotesTest(unittest.TestCase):
    def test_notes_are_grouped_by_task_and_quoted(self):
        notes = render.notes_markdown(fixture_analysis())
        self.assertIn('- P-AAAA, What did you like in this task? "Quick to find"', notes)
        self.assertIn('- P-BBBB gave up, reason: "I did not know where to look"', notes)
        self.assertIn('- P-BBBB: "Too many buttons"', notes)
        self.assertNotIn("P-PILT", notes)


class CsvTest(unittest.TestCase):
    def test_the_attempt_csv_reads_back_to_the_same_tables(self):
        analysis = fixture_analysis()
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "attempts.csv"
            path.write_text(
                render.csv_text(render.ATTEMPT_HEADER, render.attempt_csv(analysis)),
                encoding="utf-8",
            )
            again = analyse(read_exports([path]))
        _, order, _ = read_json(FIXTURE)
        self.assertEqual([task for task, _ in order], [row.task for row in again.tasks])
        self.assertEqual(render.task_table(again), render.task_table(analysis))

    def test_a_csv_can_carry_sus_and_final_answers(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "rows.csv"
            header = (
                "participant,id,success,durationMs,seq,"
                + ",".join(f"sus{i}" for i in range(1, 11))
                + ",final.like"
            )
            path.write_text(
                header + "\nP-X,open-case,yes,4000,7," + ",".join(["4", "2"] * 5) + ",Nice\n",
                encoding="utf-8",
            )
            sessions = read_csv(path)
        self.assertEqual(sus_score(sessions[0].sus), 75.0)
        self.assertEqual(sessions[0].open, {"like": "Nice"})


class CliTest(unittest.TestCase):
    def test_writes_every_table_and_figure(self):
        with tempfile.TemporaryDirectory() as folder:
            out = Path(folder) / "out"
            code = main([str(FIXTURE), "--out", str(out), "--exclude", "P-PILT"])
            self.assertEqual(code, 0)
            names = {path.name for path in out.iterdir()}
            self.assertTrue(set(PLACES) <= names)
            self.assertIn("<svg", (out / "seq-per-task.svg").read_text(encoding="utf-8"))
            sus_svg = (out / "sus-by-round.svg").read_text(encoding="utf-8")
            self.assertIn("83.8", sus_svg)
            self.assertEqual(sus_svg.count("<circle"), 7)
            for path in out.iterdir():
                text = path.read_text(encoding="utf-8")
                self.assertFalse(any(dash in text for dash in DASHES), path.name)

    def test_tied_sus_scores_stay_visible(self):
        analysis = fixture_analysis()
        analysis.sus[1].score = 100.0
        chart = charts.sus_chart(analysis)
        self.assertEqual(len(set(re.findall(r'<circle cx="[^"]+" cy="[^"]+"', chart))), 7)

    def test_a_broken_export_fails_cleanly(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "bad.json"
            path.write_text(
                json.dumps({"sessions": [{"participant": "P-X", "tasks": [{"id": "a"}]}]}),
                encoding="utf-8",
            )
            self.assertEqual(main([str(path), "--out", str(Path(folder) / "out")]), 1)


if __name__ == "__main__":
    unittest.main()
