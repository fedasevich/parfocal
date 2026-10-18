import uuid
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

from parfocal_common.schema_sql import (
    enable_tenant_isolation,
    track_updated_at,
    untrack_updated_at,
)

revision: str = "0030"
down_revision: str | None = "0029"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "verdicts",
        sa.Column("tenant_id", sa.Uuid[uuid.UUID](), nullable=False, index=True),
        sa.Column("project_id", sa.Uuid[uuid.UUID](), nullable=False),
        sa.Column("task_id", sa.Uuid[uuid.UUID](), primary_key=True),
        sa.Column("slide_id", sa.Uuid[uuid.UUID](), primary_key=True),
        sa.Column("user_id", sa.Uuid[uuid.UUID](), primary_key=True),
        sa.Column("kind", sa.String(10), primary_key=True),
        sa.Column("number", sa.Integer, primary_key=True),
        sa.Column("value", sa.String(10), nullable=False),
        sa.Column("reason", sa.String(20), nullable=True),
        sa.Column("reason_class_id", sa.Uuid[uuid.UUID](), nullable=True),
        sa.Column("note", sa.String(500), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.ForeignKeyConstraint(
            ["task_id", "slide_id", "user_id"],
            [
                "review_assignments.task_id",
                "review_assignments.slide_id",
                "review_assignments.user_id",
            ],
        ),
        sa.ForeignKeyConstraint(
            ["reason_class_id", "project_id"], ["project_classes.id", "project_classes.project_id"]
        ),
        sa.ForeignKeyConstraint(["project_id", "tenant_id"], ["projects.id", "projects.tenant_id"]),
        sa.CheckConstraint("kind IN ('region', 'cell')", name="kind"),
        sa.CheckConstraint("number > 0", name="number"),
        sa.CheckConstraint("value IN ('agree', 'disagree', 'unsure')", name="value"),
        sa.CheckConstraint(
            "(value = 'disagree') = (reason IS NOT NULL)", name="reason_on_disagree"
        ),
        sa.CheckConstraint(
            "(reason = 'wrong_class') = (reason_class_id IS NOT NULL)",
            name="wrong_class_names_class",
        ),
        sa.CheckConstraint(
            "reason IS NULL OR (kind = 'region' AND reason IN "
            "('not_class', 'boundary_off', 'two_regions', 'artefact')) OR (kind = 'cell' AND "
            "reason IN ('not_a_cell', 'wrong_class', 'boundary_off', 'artefact'))",
            name="reason_fits_kind",
        ),
    )
    for statement in [*enable_tenant_isolation("verdicts"), *track_updated_at("verdicts")]:
        op.execute(statement)


def downgrade() -> None:
    op.execute(untrack_updated_at("verdicts")[0])
    op.drop_table("verdicts")
