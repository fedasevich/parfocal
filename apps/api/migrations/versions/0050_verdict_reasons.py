from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0050"
down_revision: str | None = "0049"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

REGION_CODES = "'not_class', 'boundary_off', 'two_regions', 'artefact'"
CELL_CODES = "'not_a_cell', 'wrong_class', 'boundary_off', 'artefact'"
UNSURE_CODES = "'need_deeper_level', 'need_ihc', 'border_unclear', 'out_of_focus'"

REASONS_FIT = (
    "(value = 'agree' AND cardinality(reasons) = 0) OR "
    f"(value = 'unsure' AND reasons <@ ARRAY[{UNSURE_CODES}]::varchar[]) OR "
    f"(value = 'disagree' AND kind = 'region' AND reasons <@ ARRAY[{REGION_CODES}]::varchar[]) OR "
    f"(value = 'disagree' AND kind = 'cell' AND reasons <@ ARRAY[{CELL_CODES}]::varchar[])"
)
WRONG_CLASS_NAMES_CLASS = "('wrong_class' = ANY(reasons)) = (reason_class_id IS NOT NULL)"


def upgrade() -> None:
    op.add_column(
        "verdicts",
        sa.Column("reasons", postgresql.ARRAY(sa.String(20)), nullable=False, server_default="{}"),
    )
    op.execute("UPDATE verdicts SET reasons = ARRAY[reason] WHERE reason IS NOT NULL")
    for name in ("reason_on_disagree", "wrong_class_names_class", "reason_fits_kind"):
        op.drop_constraint(name, "verdicts", type_="check")
    op.drop_column("verdicts", "reason")
    op.create_check_constraint("reasons_fit", "verdicts", REASONS_FIT)
    op.create_check_constraint("wrong_class_names_class", "verdicts", WRONG_CLASS_NAMES_CLASS)


def downgrade() -> None:
    op.add_column("verdicts", sa.Column("reason", sa.String(20), nullable=True))
    op.execute(
        "UPDATE verdicts SET reason = CASE WHEN 'wrong_class' = ANY(reasons) THEN 'wrong_class' "
        "ELSE reasons[1] END WHERE value = 'disagree'"
    )
    op.execute(
        "UPDATE verdicts SET reason = CASE kind WHEN 'region' THEN 'boundary_off' "
        "ELSE 'not_a_cell' END WHERE value = 'disagree' AND reason IS NULL"
    )
    op.drop_constraint("reasons_fit", "verdicts", type_="check")
    op.drop_constraint("wrong_class_names_class", "verdicts", type_="check")
    op.drop_column("verdicts", "reasons")
    op.create_check_constraint(
        "reason_on_disagree", "verdicts", "(value = 'disagree') = (reason IS NOT NULL)"
    )
    op.create_check_constraint(
        "wrong_class_names_class",
        "verdicts",
        "(reason = 'wrong_class') = (reason_class_id IS NOT NULL)",
    )
    op.create_check_constraint(
        "reason_fits_kind",
        "verdicts",
        f"reason IS NULL OR (kind = 'region' AND reason IN ({REGION_CODES})) OR "
        f"(kind = 'cell' AND reason IN ({CELL_CODES}))",
    )
