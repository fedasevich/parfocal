from parfocal_api.problems import ConflictError
from parfocal_api.tables import TaskKind


class NotAReviewTaskError(ConflictError):
    code = "not-a-review-task"
    title = "An annotate task takes no decisions, opinion answers, review edits, order or queue"


def review_only(kind: str) -> None:
    if kind != TaskKind.REVIEW:
        raise NotAReviewTaskError


class NotAnAnnotateTaskError(ConflictError):
    code = "not-an-annotate-task"
    title = "Only an annotate task has a shared layer"


def annotate_only(kind: str) -> None:
    if kind != TaskKind.ANNOTATE:
        raise NotAnAnnotateTaskError
