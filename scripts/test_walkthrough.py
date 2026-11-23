import re
import unittest
from pathlib import Path

from walkthrough.check import expected_of
from walkthrough.content import CHAPTERS
from walkthrough.model import ACCOUNTS
from walkthrough.render import render
from walkthrough.resolve import (
    Seed,
    UnresolvedError,
    add_cases,
    add_projects,
    add_single,
    add_slides,
    add_task_slides,
    add_tasks,
    fill,
    unresolved,
)

ROUTES = Path(__file__).resolve().parent.parent / "apps/web/src/routes"
STUDY = "Sentinel node metastasis study"
GALLERY = "Scanner format comparison"
DASHES = "[" + chr(0x2013) + chr(0x2014) + "]"


def seeded() -> Seed:
    seed = Seed(workspace="tenant-1")
    add_projects(seed, [{"id": "p-study", "name": STUDY}, {"id": "p-gallery", "name": GALLERY}])
    add_tasks(seed, "p-study", [{"id": "t-outcome", "name": "Every outcome review"}])
    add_tasks(
        seed,
        "p-gallery",
        [
            {"id": "t-role", "name": "Role account review", "project_id": "p-gallery"},
            {"id": "t-other", "name": "Every outcome review"},
        ],
    )
    add_task_slides(
        seed, "Every outcome review", {"slides": [{"slide_id": "s-1"}, {"slide_id": "s-2"}]}
    )
    add_slides(seed, GALLERY, [{"id": "s-cmu", "label": "CMU-1.tiff"}])
    add_slides(seed, STUDY, [{"id": "s-other", "label": "CMU-1.tiff"}])
    add_cases(seed, [{"id": "c-1", "label": "Showcase case", "project_id": "p-clinical"}])
    add_single(seed, "adj_task:adjudicator", "t-queue")
    add_single(seed, "job", None)
    return seed


def route_pattern(name: str) -> re.Pattern[str]:
    stem = name.removesuffix(".tsx").removesuffix(".index")
    if stem == "index":
        return re.compile(r"^/(\?.*)?$")
    parts = []
    for part in stem.split("."):
        part = part.removesuffix("_")
        parts.append(r"[^/?]+" if part.startswith("$") else re.escape(part))
    return re.compile("^/" + "/".join(parts) + r"/?(\?.*)?$")


class ResolveTest(unittest.TestCase):
    def test_names_become_ids(self) -> None:
        seed = seeded()
        self.assertEqual(
            fill("/projects/{task_project:Role account review}/x/{task:Role account review}", seed),
            "/projects/p-gallery/x/t-role",
        )
        self.assertEqual(fill("/{project:" + STUDY + "}", seed), "/p-study")
        self.assertEqual(fill("/{workspace}", seed), "/tenant-1")

    def test_the_first_task_of_a_name_wins(self) -> None:
        seed = seeded()
        self.assertEqual(fill("{task:Every outcome review}", seed), "t-outcome")
        self.assertEqual(fill("{task_project:Every outcome review}", seed), "p-study")

    def test_slides_are_found_by_project_and_label(self) -> None:
        seed = seeded()
        self.assertEqual(fill("{slide:" + GALLERY + "|CMU-1.tiff}", seed), "s-cmu")
        self.assertEqual(fill("{slide:" + STUDY + "|CMU-1.tiff}", seed), "s-other")

    def test_task_slides_count_from_one(self) -> None:
        seed = seeded()
        self.assertEqual(fill("{task_slide:Every outcome review|2}", seed), "s-2")
        with self.assertRaises(UnresolvedError):
            fill("{task_slide:Every outcome review|3}", seed)

    def test_cases_and_singles(self) -> None:
        seed = seeded()
        self.assertEqual(
            fill("/projects/{case_project:Showcase case}/cases/{case:Showcase case}", seed),
            "/projects/p-clinical/cases/c-1",
        )
        self.assertEqual(fill("{adj_task:adjudicator}", seed), "t-queue")

    def test_missing_names_are_reported_not_guessed(self) -> None:
        seed = seeded()
        self.assertEqual(unresolved("{task:Gone}", seed), "no task named Gone")
        self.assertIsNotNone(unresolved("{job}", seed))
        self.assertIsNotNone(unresolved("{slide:no separator}", seed))
        self.assertIsNone(unresolved("/plain/path", seed))

    def test_expected_status_suffix(self) -> None:
        self.assertEqual(expected_of("/api/x"), ("/api/x", 200))
        self.assertEqual(expected_of("/api/x =403"), ("/api/x", 403))


class ContentTest(unittest.TestCase):
    def test_every_route_has_a_step(self) -> None:
        urls = [item.url for chapter in CHAPTERS for item in chapter.steps]
        shaped = [re.sub(r"\{[^}]*\}", "id", url) for url in urls]
        missing = [
            path.name
            for path in sorted(ROUTES.glob("*.tsx"))
            if path.name != "__root.tsx"
            and not any(route_pattern(path.name).match(url) for url in shaped)
        ]
        self.assertEqual(missing, [])

    def test_every_account_has_steps(self) -> None:
        used = {item.role for chapter in CHAPTERS for item in chapter.steps}
        self.assertEqual(used, set(ACCOUNTS))

    def test_text_has_no_dashes_and_no_banned_word(self) -> None:
        banned = "ver" + "dict"
        for chapter in CHAPTERS:
            texts = [chapter.title, chapter.intro]
            for item in chapter.steps:
                texts += [item.title, item.click, item.expect, item.why, item.state]
            for text in texts:
                self.assertNotRegex(text, DASHES)
                self.assertNotIn(banned, text.lower())

    def test_page_escapes_text_and_opens_links_in_a_new_tab(self) -> None:
        step = {
            "number": "1.1",
            "role": "owner",
            "role_name": "Owner",
            "account": "agent-walk@parfocal.eu",
            "title": "H&E <slide>",
            "click": "Open",
            "expect": "It opens",
            "why": "It matters",
            "gpu": True,
            "state": "",
            "link": "/projects",
            "status": "broken",
            "reason": "/api/x answered 500, not 200",
            "calls": [{"path": "/api/x", "expected": 200, "got": 500}],
        }
        page = render(
            {
                "origin": "https://app.example.test",
                "workspace": "cvut-biomedical",
                "checked_at": "2026-11-23 20:00 UTC",
                "release": "abc",
                "chapters": [
                    {
                        "number": 1,
                        "title": "Start",
                        "group": "core",
                        "group_name": "Core flow",
                        "intro": "Intro",
                        "steps": [step],
                    }
                ],
            }
        )
        self.assertIn("H&amp;E &lt;slide&gt;", page)
        self.assertIn('href="https://app.example.test/projects" target="_blank"', page)
        self.assertIn("1 broken step<", page)
        self.assertNotRegex(page, DASHES)


if __name__ == "__main__":
    unittest.main()
