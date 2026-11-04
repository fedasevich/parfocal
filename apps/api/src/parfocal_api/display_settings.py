import uuid
from enum import StrEnum
from typing import Annotated, Any

from pydantic import BaseModel, ConfigDict, Field, StrictBool, StringConstraints, field_validator

from parfocal_api.problems import ConflictError


class DrawAs(StrEnum):
    OUTLINE = "outline"
    FILL = "fill"
    DOTS = "dots"


class ColourBy(StrEnum):
    CLASS = "class"
    SCORE = "score"
    DECISION = "decision"


class ConfidenceShown(StrEnum):
    NUMBER = "number"
    WORD = "word"
    COLOUR = "colour"
    HIDDEN = "hidden"


class ObjectOrder(StrEnum):
    AI = "ai"
    LARGEST_FIRST = "largest-first"
    LEAST_SURE_FIRST = "least-sure-first"
    RANDOM = "random"


class ZoomAround(StrEnum):
    FIT = "fit"
    TIGHT = "tight"
    CONTEXT = "context"


class ButtonPlace(StrEnum):
    CARD = "card"
    UNDER_SLIDE = "under-slide"


class Lockable(StrEnum):
    CONFIDENCE = "confidence"
    HEATMAP = "heatmap"
    SCORE_CUTOFF = "score-cutoff"
    OTHER_SETS = "other-sets"
    ORDER = "order"


FIELD_OF = {
    Lockable.CONFIDENCE: "confidence",
    Lockable.HEATMAP: "heatmap",
    Lockable.SCORE_CUTOFF: "score_cutoff",
    Lockable.OTHER_SETS: "other_sets",
    Lockable.ORDER: "order",
}
MAX_OTHER_SETS = 20


class OtherSets(BaseModel):
    model_config = ConfigDict(extra="forbid")

    reviewed_layer: StrictBool = True
    result_set_ids: Annotated[list[uuid.UUID], Field(max_length=MAX_OTHER_SETS)] = []

    @field_validator("result_set_ids")
    @classmethod
    def sorted_once(cls, value: list[uuid.UUID]) -> list[uuid.UUID]:
        return sorted(set(value))


class DisplaySettings(BaseModel):
    model_config = ConfigDict(extra="forbid")

    draw_as: DrawAs = DrawAs.OUTLINE
    width: Annotated[int, Field(ge=1, le=3)] = 2
    opacity: Annotated[int, Field(ge=20, le=100, multiple_of=10)] = 100
    colour_by: ColourBy = ColourBy.CLASS
    id_labels: StrictBool = True
    confidence: ConfidenceShown = ConfidenceShown.NUMBER
    heatmap: Annotated[int, Field(ge=0, le=100, multiple_of=10)] = 0
    score_cutoff: Annotated[float, Field(ge=0, le=1)] = 0.4
    other_sets: OtherSets = OtherSets()
    order: ObjectOrder = ObjectOrder.AI
    zoom: ZoomAround = ZoomAround.FIT
    move_on: StrictBool = True
    buttons: ButtonPlace = ButtonPlace.CARD

    @field_validator("score_cutoff")
    @classmethod
    def two_places(cls, value: float) -> float:
        return round(value, 2)


type LockReason = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=5, max_length=120)
]


class TaskDisplaySettings(BaseModel):
    model_config = ConfigDict(extra="forbid")

    defaults: DisplaySettings = DisplaySettings()
    locks: dict[Lockable, LockReason] = {}


class DisplaySettingLockedError(ConflictError):
    code = "display-setting-locked"
    title = "The task locks this display setting"


def display_of(stored: Any) -> TaskDisplaySettings:
    return TaskDisplaySettings.model_validate(stored or {})


def stored_display(display: TaskDisplaySettings) -> dict[str, Any]:
    return display.model_dump(mode="json")


def locked_changes(task: TaskDisplaySettings, settings: DisplaySettings) -> list[Lockable]:
    return sorted(
        key
        for key in task.locks
        if getattr(settings, FIELD_OF[key]) != getattr(task.defaults, FIELD_OF[key])
    )


def require_unlocked(task: TaskDisplaySettings, settings: DisplaySettings) -> None:
    changed = locked_changes(task, settings)
    if changed:
        named = ", ".join(changed)
        raise DisplaySettingLockedError(f"The task locks {named}: {task.locks[changed[0]]}")
