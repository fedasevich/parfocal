import uuid

from parfocal_api.ai_changes import Change, Event, report_changes, tallied
from parfocal_api.report_template import ReportData, render_report
from parfocal_api.taxonomy import ProjectClass
from parfocal_api.training_exports import Letters
from parfocal_common.report_blocks import ExpertChanges

FIRST, SECOND = uuid.UUID(int=1), uuid.UUID(int=2)
WITH_AI, WITHOUT_AI = uuid.UUID(int=10), uuid.UUID(int=11)
TUMOUR, STROMA, IMMUNE = (
    ProjectClass(id=uuid.UUID(int=20 + key), key=key, name=name, colour="#c80000")
    for key, name in ((1, "Tumour"), (2, "Stroma"), (3, "Immune"))
)


def event(slide: uuid.UUID, found: ProjectClass, change: Change, person: str | None) -> Event:
    return Event(slide, found.id, found.name, change, person)


EVENTS = [
    event(WITH_AI, TUMOUR, Change.CONFIRMED, "A"),
    event(WITH_AI, TUMOUR, Change.UNCHECKED, None),
    event(WITH_AI, TUMOUR, Change.EDITED, "B"),
    event(WITH_AI, STROMA, Change.DELETED, "B"),
    event(WITH_AI, STROMA, Change.UNCHECKED, None),
    event(WITH_AI, STROMA, Change.ADDED, "B"),
    event(WITHOUT_AI, IMMUNE, Change.ADDED, "A"),
    event(WITHOUT_AI, IMMUNE, Change.ADDED, "A"),
    event(WITHOUT_AI, TUMOUR, Change.ADDED, "B"),
    Event(WITHOUT_AI, None, "unclassified", Change.ADDED, "A"),
]


def changes() -> ReportData:
    found = tallied(
        uuid.UUID(int=99),
        [(WITH_AI, "S-1", uuid.UUID(int=30)), (WITHOUT_AI, "S-2", None)],
        EVENTS,
        Letters([FIRST, SECOND]),
        [IMMUNE, STROMA, TUMOUR],
    )
    assert [(row.class_name, row.ai_objects, row.added) for row in found.classes] == [
        ("Tumour", 3, 1),
        ("Stroma", 2, 1),
        ("Immune", 0, 2),
        ("unclassified", 0, 1),
    ]
    assert [(row.slide, row.total.ai_objects, row.total.added) for row in found.slides] == [
        ("S-1", 3 + 2, 1),
        ("S-2", 0, 4),
    ]
    assert found.slides[1].result_set_id is None
    total = found.total
    assert (total.confirmed, total.edited, total.deleted, total.unchecked) == (1, 1, 1, 2)
    assert [(p.letter, p.confirmed, p.edited, p.deleted, p.added) for p in total.by] == [
        ("A", 1, 0, 0, 3),
        ("B", 0, 1, 1, 2),
    ]
    return ReportData(
        project_name="P",
        task_name="Fix the AI",
        version=1,
        checksum="",
        signed_off_on=None,
        sample=False,
        classes=(),
        fleiss_kappa=None,
        decisions={},
        blocks=(
            ExpertChanges(kind="ai-changes", title="By class"),
            ExpertChanges(kind="ai-changes", title="By slide", group_by="slide", people=False),
        ),
        ai_changes=report_changes(found),
    )


def test_the_block_shows_hand_counted_changes_per_class_and_slide_with_letters() -> None:
    source = render_report(changes()).source
    assert '[#"Tumour"], [#"3"], [#"1"], [#"1"], [#"0"], [#"1"], [#"1"], [#"A 1, B 2"],' in source
    assert '[#"Stroma"], [#"2"], [#"0"], [#"0"], [#"1"], [#"1"], [#"1"], [#"B 2"],' in source
    assert '[#"Immune"], [#"0"], [#"0"], [#"0"], [#"0"], [#"0"], [#"2"], [#"A 2"],' in source
    assert '[#"All"], [#"5"], [#"1"], [#"1"], [#"1"], [#"2"], [#"5"], [#"A 4, B 4"],' in source
    assert '[#"S-2"], [#"0"], [#"0"], [#"0"], [#"0"], [#"0"], [#"4"],' in source
    assert '[#"All"], [#"5"], [#"1"], [#"1"], [#"1"], [#"2"], [#"5"],\n' in source
    assert str(FIRST) not in source
    assert str(SECOND) not in source


def test_the_block_says_so_when_the_task_has_no_changes_to_count() -> None:
    data = ReportData(
        project_name="P",
        task_name="Review",
        version=1,
        checksum="",
        signed_off_on=None,
        sample=False,
        classes=(),
        fleiss_kappa=None,
        decisions={},
        blocks=(ExpertChanges(kind="ai-changes", title="Changes"),),
    )
    assert (
        "Only an annotate task counts how the experts changed the AI." in render_report(data).source
    )
