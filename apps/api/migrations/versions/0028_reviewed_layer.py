import uuid
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from geoalchemy2 import Geometry

from parfocal_common.schema_sql import (
    enable_tenant_isolation,
    track_updated_at,
    untrack_updated_at,
)

revision: str = "0028"
down_revision: str | None = "0027"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("annotations", sa.Column("task_id", sa.Uuid[uuid.UUID](), nullable=True))
    op.create_index("ix_annotations_task_id", "annotations", ["task_id"])
    op.create_foreign_key(
        "fk_annotations_task_id_review_task_slides",
        "annotations",
        "review_task_slides",
        ["task_id", "slide_id"],
        ["task_id", "slide_id"],
    )
    op.create_table(
        "review_edits",
        sa.Column("tenant_id", sa.Uuid[uuid.UUID](), nullable=False, index=True),
        sa.Column("project_id", sa.Uuid[uuid.UUID](), nullable=False),
        sa.Column("task_id", sa.Uuid[uuid.UUID](), primary_key=True),
        sa.Column("slide_id", sa.Uuid[uuid.UUID](), primary_key=True),
        sa.Column("user_id", sa.Uuid[uuid.UUID](), primary_key=True),
        sa.Column("kind", sa.String(10), primary_key=True),
        sa.Column("number", sa.Integer, primary_key=True),
        sa.Column("class_id", sa.Uuid[uuid.UUID](), nullable=True),
        sa.Column[object]("geometry", Geometry(spatial_index=False), nullable=True),
        sa.Column("deleted", sa.Boolean, nullable=False, server_default=sa.text("false")),
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
            ["class_id", "project_id"], ["project_classes.id", "project_classes.project_id"]
        ),
        sa.ForeignKeyConstraint(["project_id", "tenant_id"], ["projects.id", "projects.tenant_id"]),
        sa.CheckConstraint("kind IN ('region', 'cell')", name="kind"),
        sa.CheckConstraint("number > 0", name="number"),
        sa.CheckConstraint(
            "deleted OR class_id IS NOT NULL OR geometry IS NOT NULL", name="changes_something"
        ),
        sa.CheckConstraint("geometry IS NULL OR ST_IsValid(geometry)", name="geometry_valid"),
    )
    for statement in [*enable_tenant_isolation("review_edits"), *track_updated_at("review_edits")]:
        op.execute(statement)


def downgrade() -> None:
    op.execute(untrack_updated_at("review_edits")[0])
    op.drop_table("review_edits")
    op.drop_constraint(
        "fk_annotations_task_id_review_task_slides", "annotations", type_="foreignkey"
    )
    op.drop_index("ix_annotations_task_id", "annotations")
    op.drop_column("annotations", "task_id")
