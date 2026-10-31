import uuid
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

from parfocal_common.schema_sql import enable_tenant_isolation

revision: str = "0040"
down_revision: str | None = "0039"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "review_order",
        sa.Column("tenant_id", sa.Uuid[uuid.UUID](), nullable=False, index=True),
        sa.Column("project_id", sa.Uuid[uuid.UUID](), nullable=False),
        sa.Column("task_id", sa.Uuid[uuid.UUID](), primary_key=True),
        sa.Column("slide_id", sa.Uuid[uuid.UUID](), primary_key=True),
        sa.Column("seed", sa.BigInteger, nullable=False),
        sa.Column("count", sa.Integer, nullable=False),
        sa.Column("objects", sa.LargeBinary, nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.ForeignKeyConstraint(
            ["task_id", "slide_id"], ["review_task_slides.task_id", "review_task_slides.slide_id"]
        ),
        sa.ForeignKeyConstraint(["project_id", "tenant_id"], ["projects.id", "projects.tenant_id"]),
        sa.CheckConstraint("count >= 0", name="count"),
        sa.CheckConstraint("octet_length(objects) = 5 * count", name="packed"),
    )
    for statement in enable_tenant_isolation("review_order"):
        op.execute(statement)


def downgrade() -> None:
    op.drop_table("review_order")
