import uuid
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0020"
down_revision: str | None = "0019"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "projects", sa.Column("colour", sa.SmallInteger, nullable=False, server_default="0")
    )
    op.add_column(
        "projects", sa.Column("template", sa.String(20), nullable=False, server_default="none")
    )
    op.add_column("projects", sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column(
        "projects",
        sa.Column(
            "created_by_user_id", sa.Uuid[uuid.UUID](), sa.ForeignKey("users.id"), nullable=True
        ),
    )
    op.create_check_constraint("colour", "projects", "colour BETWEEN 0 AND 11")
    op.create_check_constraint(
        "template", "projects", "template IN ('none', 'sentinel-node', 'cell-review')"
    )


def downgrade() -> None:
    op.drop_constraint("template", "projects", type_="check")
    op.drop_constraint("colour", "projects", type_="check")
    op.drop_column("projects", "created_by_user_id")
    op.drop_column("projects", "archived_at")
    op.drop_column("projects", "template")
    op.drop_column("projects", "colour")
