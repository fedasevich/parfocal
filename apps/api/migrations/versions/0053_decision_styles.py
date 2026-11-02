from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0053"
down_revision: str | None = "0052"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

REGION_CODES = "'not_class', 'boundary_off', 'two_regions', 'artefact'"
CELL_CODES = "'not_a_cell', 'wrong_class', 'boundary_off', 'artefact'"
OLD_UNSURE_CODES = "'need_deeper_level', 'need_ihc', 'border_unclear', 'out_of_focus'"
UNSURE_CODES = f"{OLD_UNSURE_CODES}, 'need_second_look'"
ANSWER_CLASS_KEY = "fk_verdicts_answer_class_id_project_id_project_classes"


def reasons_fit(unsure: str) -> str:
    return (
        "(value = 'agree' AND cardinality(reasons) = 0) OR "
        f"(value = 'unsure' AND reasons <@ ARRAY[{unsure}]::varchar[]) OR "
        f"(value = 'disagree' AND kind = 'region' AND reasons <@ ARRAY[{REGION_CODES}]::varchar[]) "
        f"OR (value = 'disagree' AND kind = 'cell' AND reasons <@ ARRAY[{CELL_CODES}]::varchar[])"
    )


ANSWER_FITS_STYLE = (
    "(style = 'certainty' AND answer IN ('1', '2', '3', '4', '5', 'unsure')) OR "
    "(style = 'agree' AND answer IN ('agree', 'disagree', 'unsure')) OR "
    "(style = 'yes-no' AND answer IN ('yes', 'no', 'unsure')) OR "
    "(style = 'blind' AND answer IN ('class', 'unsure'))"
)
COUNTS_AS = (
    "cardinality(counts_as) = 5 AND counts_as <@ ARRAY['agree', 'disagree', 'unsure']::varchar[] "
    "AND 'agree' = ANY(counts_as) AND 'disagree' = ANY(counts_as)"
)
DEFAULT_COUNTS_AS = "'{disagree,disagree,unsure,agree,agree}'"


def upgrade() -> None:
    op.add_column(
        "review_tasks",
        sa.Column("decision_style", sa.String(10), nullable=False, server_default="agree"),
    )
    op.alter_column("review_tasks", "decision_style", server_default="certainty")
    op.add_column(
        "review_tasks",
        sa.Column(
            "counts_as",
            postgresql.ARRAY(sa.String(10)),
            nullable=False,
            server_default=sa.text(DEFAULT_COUNTS_AS),
        ),
    )
    op.add_column(
        "review_tasks",
        sa.Column(
            "counts_as_changes",
            postgresql.JSONB,
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
    )
    op.add_column("review_tasks", sa.Column("question", sa.String(200), nullable=True))
    op.create_check_constraint(
        "decision_style",
        "review_tasks",
        "decision_style IN ('certainty', 'agree', 'yes-no', 'blind')",
    )
    op.create_check_constraint("counts_as", "review_tasks", COUNTS_AS)
    op.add_column(
        "verdicts", sa.Column("style", sa.String(10), nullable=False, server_default="agree")
    )
    op.alter_column("verdicts", "style", server_default=None)
    op.add_column("verdicts", sa.Column("answer", sa.String(10), nullable=True))
    op.execute("UPDATE verdicts SET answer = value")
    op.alter_column("verdicts", "answer", nullable=False)
    op.add_column("verdicts", sa.Column("answer_class_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        ANSWER_CLASS_KEY,
        "verdicts",
        "project_classes",
        ["answer_class_id", "project_id"],
        ["id", "project_id"],
    )
    op.create_check_constraint(
        "style", "verdicts", "style IN ('certainty', 'agree', 'yes-no', 'blind')"
    )
    op.create_check_constraint("answer_fits_style", "verdicts", ANSWER_FITS_STYLE)
    op.create_check_constraint(
        "answer_names_class", "verdicts", "(answer = 'class') = (answer_class_id IS NOT NULL)"
    )
    op.drop_constraint("reasons_fit", "verdicts", type_="check")
    op.create_check_constraint("reasons_fit", "verdicts", reasons_fit(UNSURE_CODES))


def downgrade() -> None:
    op.execute(
        "UPDATE verdicts SET reasons = array_remove(reasons, 'need_second_look') "
        "WHERE 'need_second_look' = ANY(reasons)"
    )
    op.drop_constraint("reasons_fit", "verdicts", type_="check")
    op.create_check_constraint("reasons_fit", "verdicts", reasons_fit(OLD_UNSURE_CODES))
    op.drop_constraint("answer_names_class", "verdicts", type_="check")
    op.drop_constraint("answer_fits_style", "verdicts", type_="check")
    op.drop_constraint("style", "verdicts", type_="check")
    op.drop_constraint(ANSWER_CLASS_KEY, "verdicts", type_="foreignkey")
    op.drop_column("verdicts", "answer_class_id")
    op.drop_column("verdicts", "answer")
    op.drop_column("verdicts", "style")
    op.drop_constraint("counts_as", "review_tasks", type_="check")
    op.drop_constraint("decision_style", "review_tasks", type_="check")
    op.drop_column("review_tasks", "question")
    op.drop_column("review_tasks", "counts_as_changes")
    op.drop_column("review_tasks", "counts_as")
    op.drop_column("review_tasks", "decision_style")
