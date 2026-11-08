import asyncio
import dataclasses
import uuid
from typing import Any

import pytest
from db_support import APP_URL, ApiAs, with_database
from sqlalchemy import Column
from sqlalchemy.ext.asyncio import create_async_engine
from test_annotations import square
from test_review_decisions import Called, behind_the_triggers, called, decide, skip
from test_reviewed_layer import edit
from workspace_support import owner

from parfocal_api.tables import VerdictValue
from parfocal_api.training_examples import (
    PlainRecolour,
    ReviewedDecision,
    ReviewSkip,
    TrainingExample,
    decision_columns,
    example_of,
    training_examples,
)
from parfocal_common.data_classes import DataClass, classification_of
from parfocal_common.db import DatabaseScope, async_database_url, scoped_transaction

TUMOR = uuid.uuid4()
STROMA = uuid.uuid4()
REVIEWER = uuid.uuid4()


def decision(**changes: Any) -> ReviewedDecision:
    base = ReviewedDecision(
        tenant_id=uuid.uuid4(),
        project_id=uuid.uuid4(),
        task_id=uuid.uuid4(),
        slide_id=uuid.uuid4(),
        reviewer_id=REVIEWER,
        kind="cell",
        number=4,
        value="agree",
        reasons=[],
        reason_class_id=None,
        answer_class_id=None,
        ai_class_id=TUMOR,
        ai_score=180,
        reopened=False,
    )
    return dataclasses.replace(base, **changes)


def learned(**changes: Any) -> TrainingExample:
    example = example_of(decision(**changes))
    assert example is not None
    return example


def test_an_agreed_call_teaches_the_ai_class_with_the_reviewer_and_the_score() -> None:
    example = learned()
    assert (example.decision, example.final_class_id, example.ai_score) == (
        VerdictValue.AGREE,
        TUMOR,
        180,
    )
    assert (example.reviewer_id, example.rejected) == (REVIEWER, False)


def test_a_wrong_class_disagreement_teaches_the_reviewers_class() -> None:
    example = learned(value="disagree", reasons=["wrong_class"], reason_class_id=STROMA)
    assert (example.decision, example.ai_class_id, example.final_class_id) == (
        VerdictValue.DISAGREE,
        TUMOR,
        STROMA,
    )
    assert example.reasons == ("wrong_class",)
    assert not example.rejected


def test_a_blind_pick_teaches_the_picked_class() -> None:
    assert learned(value="disagree", answer_class_id=STROMA).final_class_id == STROMA


def test_a_disagreement_with_no_fix_is_a_rejected_call() -> None:
    example = learned(value="disagree", reasons=["not_a_cell"])
    assert (example.final_class_id, example.rejected) == (None, True)


def test_a_reshape_in_review_teaches_the_new_shape() -> None:
    shape = square(0, 0, 20)
    example = learned(value="disagree", reasons=["boundary_off"], edited_geometry=shape)
    assert (example.geometry, example.rejected) == (shape, False)
    assert learned(value="disagree", edited_class_id=STROMA).final_class_id == STROMA
    assert learned(value="disagree", edited_class_id=STROMA, edit_deleted=True).rejected


@pytest.mark.parametrize(
    "event",
    [
        pytest.param(decision(value="unsure", reasons=["need_ihc"]), id="unsure"),
        pytest.param(decision(reopened=True), id="reopened"),
        pytest.param(decision(reviewer_id=None), id="no-reviewer"),
        pytest.param(ReviewSkip(uuid.uuid4(), uuid.uuid4(), REVIEWER, "cell", 4), id="skip"),
        pytest.param(PlainRecolour(uuid.uuid4(), REVIEWER, STROMA), id="recolour"),
        pytest.param(PlainRecolour(uuid.uuid4(), None, STROMA), id="anonymous-recolour"),
    ],
)
def test_events_that_never_teach(event: Any) -> None:
    assert example_of(event) is None


def test_examples_carry_no_patient_data() -> None:
    read: list[Column[Any]] = [
        column
        for selected in decision_columns()
        for column in selected.base_columns
        if isinstance(column, Column)
    ]
    assert read
    classes = {classification_of(column.info) for column in read}
    assert classes <= {DataClass.OPERATIONAL, DataClass.PERSONAL}
    fields = {field.name for field in dataclasses.fields(TrainingExample)}
    assert not fields & {"note", "reopened_note", "text", "preset", "email", "display_name"}


def captured(database: str, c: Called) -> dict[int, TrainingExample]:
    tenant = owner(database, f"SELECT tenant_id FROM projects WHERE id = '{c.r.project}'")[0][0]

    async def go() -> list[TrainingExample]:
        engine = create_async_engine(async_database_url(with_database(APP_URL, database)))
        try:
            scope = DatabaseScope(tenant_id=uuid.UUID(str(tenant)))
            async with scoped_transaction(engine, scope) as connection:
                return await training_examples(connection, c.r.project)
        finally:
            await engine.dispose()

    examples = asyncio.run(go())
    assert all(example.task_id == c.r.task for example in examples)
    return {example.number: example for example in examples if example.kind == "region"}


@pytest.mark.db
def test_only_reviewed_decisions_become_training_examples(api: ApiAs, database: str) -> None:
    c = called(api, database)
    first = c.r.people["first"].user_id
    assert decide(api, c, "T1", {"value": "agree"}).status_code == 200
    assert skip(api, c, "T2").status_code == 200
    assert captured(database, c).keys() == {1}

    assert decide(api, c, "T2", {"value": "unsure", "reasons": ["need_ihc"]}).status_code == 200
    assert captured(database, c).keys() == {1}

    retyped = {"value": "disagree", "reasons": ["not_class"]}
    assert decide(api, c, "T2", retyped).status_code == 200
    assert edit(api, c.r, "first", "T2", {"class_id": str(c.stroma)}).status_code == 200
    examples = captured(database, c)
    assert (examples[1].reviewer_id, examples[1].final_class_id, examples[1].ai_score) == (
        first,
        c.r.tumor,
        200,
    )
    assert (examples[2].decision, examples[2].ai_class_id, examples[2].final_class_id) == (
        VerdictValue.DISAGREE,
        c.r.tumor,
        c.stroma,
    )

    behind_the_triggers(
        database,
        f"UPDATE verdicts SET reopened_at = now() WHERE task_id = '{c.r.task}' AND number = 1;",
    )
    assert captured(database, c).keys() == {2}
    assert decide(api, c, "T1", {"value": "agree"}).status_code == 200
    assert captured(database, c).keys() == {1, 2}


@pytest.mark.db
def test_a_recolour_outside_review_teaches_nothing(api: ApiAs, database: str) -> None:
    c = called(api, database)
    annotations = api(c.r.people["owner"])
    path = f"/api/slides/{c.r.slide}/annotations"
    drawn = annotations.post(path, json={"kind": "region", "geometry": square(0, 0)})
    assert drawn.status_code == 201, drawn.text
    recoloured = annotations.patch(
        f"{path}/{drawn.json()['id']}", json={"version": 1, "class_id": str(c.stroma)}
    )
    assert recoloured.status_code == 200, recoloured.text
    assert captured(database, c) == {}
