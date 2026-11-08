import uuid
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

from parfocal_common.schema_sql import (
    enable_tenant_isolation,
    track_updated_at,
    untrack_updated_at,
)

revision: str = "0101"
down_revision: str | None = "0100"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

AI_CLASS_KEY = "fk_verdicts_ai_class_id_project_id_project_classes"

BACKFILL_REGION_CALLS = """
UPDATE verdicts AS v
SET ai_class_id = called.class_id, ai_score = called.score
FROM (
  SELECT s.task_id, s.slide_id, o.number, c.class_id, o.score
  FROM review_task_slides AS s
  JOIN result_objects AS o ON o.result_set_id = s.result_set_id AND o.kind = 'region'
  LEFT JOIN result_set_classes AS c
    ON c.result_set_id = o.result_set_id AND c.position = o.class_index
) AS called
WHERE v.kind = 'region' AND v.task_id = called.task_id AND v.slide_id = called.slide_id
  AND v.number = called.number
"""


def upgrade() -> None:
    op.add_column("verdicts", sa.Column("ai_class_id", sa.Uuid(), nullable=True))
    op.add_column("verdicts", sa.Column("ai_score", sa.SmallInteger(), nullable=True))
    op.create_foreign_key(
        AI_CLASS_KEY,
        "verdicts",
        "project_classes",
        ["ai_class_id", "project_id"],
        ["id", "project_id"],
    )
    op.create_check_constraint("ai_score", "verdicts", "ai_score BETWEEN 0 AND 255")
    op.execute("ALTER TABLE verdicts DISABLE TRIGGER verdicts_touch_updated_at")
    op.execute(BACKFILL_REGION_CALLS)
    op.execute("ALTER TABLE verdicts ENABLE TRIGGER verdicts_touch_updated_at")
    op.create_table(
        "review_skips",
        sa.Column("tenant_id", sa.Uuid[uuid.UUID](), nullable=False, index=True),
        sa.Column("project_id", sa.Uuid[uuid.UUID](), nullable=False),
        sa.Column("task_id", sa.Uuid[uuid.UUID](), primary_key=True),
        sa.Column("slide_id", sa.Uuid[uuid.UUID](), primary_key=True),
        sa.Column("user_id", sa.Uuid[uuid.UUID](), primary_key=True),
        sa.Column("kind", sa.String(10), primary_key=True),
        sa.Column("number", sa.Integer, primary_key=True),
        sa.Column("ai_class_id", sa.Uuid[uuid.UUID](), nullable=True),
        sa.Column("ai_score", sa.SmallInteger(), nullable=True),
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
            ["ai_class_id", "project_id"], ["project_classes.id", "project_classes.project_id"]
        ),
        sa.ForeignKeyConstraint(["project_id", "tenant_id"], ["projects.id", "projects.tenant_id"]),
        sa.CheckConstraint("kind IN ('region', 'cell')", name="kind"),
        sa.CheckConstraint("number > 0", name="number"),
        sa.CheckConstraint("ai_score BETWEEN 0 AND 255", name="ai_score"),
    )
    for statement in [*enable_tenant_isolation("review_skips"), *track_updated_at("review_skips")]:
        op.execute(statement)


def downgrade() -> None:
    op.execute(untrack_updated_at("review_skips")[0])
    op.drop_table("review_skips")
    op.drop_constraint("ai_score", "verdicts", type_="check")
    op.drop_constraint(AI_CLASS_KEY, "verdicts", type_="foreignkey")
    op.drop_column("verdicts", "ai_score")
    op.drop_column("verdicts", "ai_class_id")
