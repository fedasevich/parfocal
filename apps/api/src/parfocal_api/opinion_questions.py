import uuid
from typing import Annotated, Any, Literal

from pydantic import BaseModel, Field, StringConstraints, TypeAdapter, model_validator
from sqlalchemy import func, insert, select
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.tables import opinion_forms

type Key = Annotated[str, StringConstraints(pattern=r"^[a-z][a-z0-9_]{0,39}$")]
type Label = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
type Option = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)]
type EndLabel = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=40)
]


class QuestionBase(BaseModel):
    key: Key
    label: Label
    required: bool = False
    quick: bool = False


class ScaleQuestion(QuestionBase):
    kind: Literal["scale"]
    min: Annotated[int, Field(ge=0, le=10)] = 1
    max: Annotated[int, Field(ge=1, le=10)] = 5
    min_label: EndLabel | None = None
    max_label: EndLabel | None = None

    @model_validator(mode="after")
    def ordered(self) -> ScaleQuestion:
        if self.max <= self.min:
            raise ValueError("The top of a scale must be above its bottom")
        return self


class ChoiceQuestion(QuestionBase):
    kind: Literal["choice"]
    options: Annotated[list[Option], Field(min_length=2, max_length=12)]

    @model_validator(mode="after")
    def distinct(self) -> ChoiceQuestion:
        if len({option.casefold() for option in self.options}) != len(self.options):
            raise ValueError("Each option must be different")
        return self


class YesNoQuestion(QuestionBase):
    kind: Literal["yesno"]


class TextQuestion(QuestionBase):
    kind: Literal["text"]
    max_length: Annotated[int, Field(ge=1, le=2000)] = 2000


type Question = Annotated[
    ScaleQuestion | ChoiceQuestion | YesNoQuestion | TextQuestion, Field(discriminator="kind")
]
QUESTIONS = TypeAdapter(list[Question])


class FormChange(BaseModel):
    questions: Annotated[list[Question], Field(min_length=1, max_length=12)]

    @model_validator(mode="after")
    def distinct_keys(self) -> FormChange:
        keys = [question.key for question in self.questions]
        if len(set(keys)) != len(keys):
            raise ValueError("Each question needs its own key")
        if sum(question.quick for question in self.questions) > 3:
            raise ValueError("At most three questions are quick")
        return self


DEFAULT_QUESTIONS: list[Question] = [
    ScaleQuestion(
        kind="scale",
        key="acceptable",
        label="Is the AI result acceptable for this slide?",
        required=True,
        quick=True,
        min_label="unusable",
        max_label="sign as is",
    ),
    ChoiceQuestion(
        kind="choice",
        key="main_error",
        label="Main error type",
        quick=True,
        options=["None", "Missed tumor", "False tumor", "Wrong cell types", "Boundaries"],
    ),
    YesNoQuestion(
        kind="yesno", key="sign_as_is", label="Would you sign this without changes?", quick=True
    ),
    TextQuestion(kind="text", key="comment", label="Comment"),
]


def dumped(questions: list[Question]) -> list[dict[str, Any]]:
    return [question.model_dump(mode="json") for question in questions]


async def publish(
    connection: AsyncConnection,
    tenant_id: uuid.UUID,
    project_id: uuid.UUID,
    user_id: uuid.UUID | None,
    questions: list[Question],
) -> int:
    latest = await connection.scalar(
        select(func.coalesce(func.max(opinion_forms.c.version), 0)).where(
            opinion_forms.c.project_id == project_id
        )
    )
    version = int(latest or 0) + 1
    await connection.execute(
        insert(opinion_forms).values(
            tenant_id=tenant_id,
            project_id=project_id,
            version=version,
            questions=dumped(questions),
            created_by_user_id=user_id,
        )
    )
    return version
