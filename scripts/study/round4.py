from dataclasses import dataclass

DECK = "Round 4 deck (Viewer Usability Study, Round 4)"


def slide(number: str, name: str) -> str:
    return f"{DECK}, slide {number} ({name})"


METHOD = slide("03", "Study · method")
RESULTS = slide("04", "Study · results")
MOVEMENT = slide("05", "Study · movement metrics")
BEFORE_AFTER = slide("06", "Study · before and after")
PER_TASK = slide("07", "Study · per task")

PARTICIPANTS = 4
TASKS = 10
COMPLETED = (40, 40)
MEAN_SEQ = "6.4"
SEQ_SIX_OR_SEVEN = (35, 40)
DEAD_CLICKS = (42, 277)
DEAD_CLICK_SHARE = "15%"
TASKS_WITHOUT_DEAD_CLICK = (29, 40)
FIRST_ACTION_SECONDS = "4.8"
MEAN_SUS = "83.8"
SUS_PER_PARTICIPANT = (("P1", 100.0), ("P2", 95.0), ("P3", 80.0), ("P4", 60.0))
ROUND1_SUS = 52.5
ROUND1_PARTICIPANTS = 1


@dataclass(frozen=True)
class Round4Task:
    id: str
    name: str
    median_seconds: str
    seq: str


TASK_FIGURES = (
    Round4Task("open-case", "Open a case", "5.9", "7.0"),
    Round4Task("patient-details", "Patient details", "39.7", "6.0"),
    Round4Task("unsure-place", "Unsure place", "17.2", "6.3"),
    Round4Task("check-cells", "Check 4 cells", "36.9", "5.8"),
    Round4Task("change-type", "Change a type", "5.0", "7.0"),
    Round4Task("whole-slide", "Whole-slide peek", "29.7", "6.5"),
    Round4Task("compare", "Compare", "6.9", "6.5"),
    Round4Task("add-scans", "Add slides", "19.2", "6.3"),
    Round4Task("upload-problems", "Upload problems", "28.6", "6.3"),
    Round4Task("sign-out", "Sign out", "11.2", "6.5"),
)

BY_ID = {task.id: task for task in TASK_FIGURES}
