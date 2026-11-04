import uuid
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

from parfocal_common.schema_sql import (
    enable_tenant_isolation,
    track_updated_at,
    untrack_updated_at,
)

revision: str = "0086"
down_revision: str | None = "0085"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "slide_coverage",
        sa.Column("tenant_id", sa.Uuid[uuid.UUID](), nullable=False, index=True),
        sa.Column(
            "slide_id",
            sa.Uuid[uuid.UUID](),
            sa.ForeignKey("slides.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "user_id",
            sa.Uuid[uuid.UUID](),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("cell", sa.Integer, nullable=False),
        sa.Column("columns", sa.Integer, nullable=False),
        sa.Column("rows", sa.Integer, nullable=False),
        sa.Column("seen", sa.LargeBinary, nullable=False),
        sa.Column("seen_cells", sa.Integer, nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
    )
    for statement in [
        *enable_tenant_isolation("slide_coverage"),
        *track_updated_at("slide_coverage"),
    ]:
        op.execute(statement)


def downgrade() -> None:
    op.execute(untrack_updated_at("slide_coverage")[0])
    op.drop_table("slide_coverage")
