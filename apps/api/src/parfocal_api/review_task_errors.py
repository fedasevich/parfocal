from parfocal_api.problems import BadRequestError, ConflictError


class ScopeKindsRepeatedError(BadRequestError):
    code = "scope-kinds-repeated"
    title = "Each part of the scope is a different kind"


class ScopeNotForKindError(BadRequestError):
    code = "scope-not-for-task-kind"
    title = "Only an annotate task takes the whole slide, and it takes nothing else"


class TaskNeedsSlidesError(BadRequestError):
    code = "task-needs-slides"
    title = "A task needs at least one slide of this project"


class UnknownSlideError(BadRequestError):
    code = "unknown-slide"
    title = "A slide or case is not in this project"


class NoResultSetError(BadRequestError):
    code = "no-result-set"
    title = "A slide has no finished result set to review"


class NotAReviewerError(BadRequestError):
    code = "not-a-project-reviewer"
    title = "Every reviewer must be an owner or reviewer of this project"


class BadPairsError(BadRequestError):
    code = "bad-pairs"
    title = "Each pair needs a task slide and a task reviewer, and every slide a reviewer"


class UnknownFormVersionError(BadRequestError):
    code = "unknown-opinion-form-version"
    title = "This project has no such opinion form version"


class UnknownStudyTemplateError(BadRequestError):
    code = "unknown-study-template"
    title = "This workspace has no such study template version"


class UnknownResultSetError(BadRequestError):
    code = "unknown-result-set"
    title = "This project has no such result set"


class StyleLockedError(ConflictError):
    code = "decision-style-locked"
    title = "The decision style cannot change once a decision exists"


class CountsAsSignedOffError(ConflictError):
    code = "counts-as-signed-off"
    title = "Counts as cannot change after sign-off"


class OutlineOverlapSignedOffError(ConflictError):
    code = "outline-overlap-signed-off"
    title = "The outline overlap cannot change after sign-off"


class CheckNotForKindError(BadRequestError):
    code = "check-not-for-task-kind"
    title = "Only an annotate task has check options"


class BlindFirstNotForKindError(BadRequestError):
    code = "blind-first-not-for-task-kind"
    title = "Only an annotate task can be blind first"


class StudyTemplateRetiredError(ConflictError):
    code = "study-template-retired"
    title = "This study template is retired"
