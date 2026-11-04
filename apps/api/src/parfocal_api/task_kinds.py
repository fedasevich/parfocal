from parfocal_api.problems import ConflictError
from parfocal_api.tables import TaskKind


class NotAReviewTaskError(ConflictError):
    code = "not-a-review-task"
    title = "An annotate task takes no decisions, opinion answers, review edits, order or queue"


def review_only(kind: str) -> None:
    if kind != TaskKind.REVIEW:
        raise NotAReviewTaskError
