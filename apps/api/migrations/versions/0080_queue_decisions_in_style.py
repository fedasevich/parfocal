import uuid
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0080"
down_revision: str | None = "0079"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TABLE = "disagreement_decisions"
ANSWER_CLASS_KEY = "fk_disagreement_decisions_answer_class_id_project_classes"
ANSWER_FITS_STYLE = (
    "style IS NULL OR "
    "(style = 'certainty' AND answer IN ('1', '2', '3', '4', '5', 'unsure')) OR "
    "(style = 'agree' AND answer IN ('agree', 'disagree', 'unsure')) OR "
    "(style = 'yes-no' AND answer IN ('yes', 'no', 'unsure')) OR "
    "(style = 'blind' AND answer IN ('class', 'unsure'))"
)
CHECKS = {
    "style": "style IS NULL OR style IN ('certainty', 'agree', 'yes-no', 'blind')",
    "answer_fits_style": ANSWER_FITS_STYLE,
    "style_with_answer": "(style IS NULL) = (answer IS NULL)",
    "answer_names_class": (
        "(answer = 'class') = (answer_class_id IS NOT NULL) "
        "AND (answer IS NOT NULL OR answer_class_id IS NULL)"
    ),
    "value": "value IS NULL OR value IN ('agree', 'disagree', 'unsure')",
    "decided_or_left_open": (
        "NOT (left_open AND value IS NOT NULL) "
        "AND (left_open OR value IS NOT NULL OR edits_settled_at IS NOT NULL)"
    ),
}


def upgrade() -> None:
    op.alter_column(TABLE, "decision", nullable=True)
    op.add_column(TABLE, sa.Column("style", sa.String(10), nullable=True))
    op.add_column(TABLE, sa.Column("answer", sa.String(10), nullable=True))
    op.add_column(TABLE, sa.Column("answer_class_id", sa.Uuid[uuid.UUID](), nullable=True))
    op.add_column(TABLE, sa.Column("value", sa.String(10), nullable=True))
    op.add_column(
        TABLE, sa.Column("left_open", sa.Boolean(), nullable=False, server_default=sa.false())
    )
    op.add_column(TABLE, sa.Column("edits_settled_at", sa.DateTime(timezone=True), nullable=True))
    op.execute(
        "UPDATE disagreement_decisions SET value = CASE decision "
        "WHEN 'keep-ai' THEN 'agree' ELSE 'disagree' END WHERE decision IS NOT NULL"
    )
    op.create_foreign_key(
        ANSWER_CLASS_KEY,
        TABLE,
        "project_classes",
        ["answer_class_id", "project_id"],
        ["id", "project_id"],
    )
    for name, condition in CHECKS.items():
        op.create_check_constraint(name, TABLE, condition)
    op.add_column("verdicts", sa.Column("reopened_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("verdicts", sa.Column("reopened_note", sa.String(500), nullable=True))


def downgrade() -> None:
    op.drop_column("verdicts", "reopened_note")
    op.drop_column("verdicts", "reopened_at")
    for name in reversed(CHECKS):
        op.drop_constraint(name, TABLE, type_="check")
    op.drop_constraint(ANSWER_CLASS_KEY, TABLE, type_="foreignkey")
    op.execute(
        "UPDATE disagreement_decisions SET decision = CASE value "
        "WHEN 'agree' THEN 'keep-ai' ELSE 'go-with-reviewers' END "
        "WHERE decision IS NULL AND value IN ('agree', 'disagree')"
    )
    op.execute("DELETE FROM disagreement_decisions WHERE decision IS NULL")
    for column in ("edits_settled_at", "left_open", "value", "answer_class_id", "answer", "style"):
        op.drop_column(TABLE, column)
    op.alter_column(TABLE, "decision", nullable=False)
