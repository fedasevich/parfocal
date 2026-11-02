from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0062"
down_revision: str | None = "0061"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "projects",
        sa.Column("sample", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.create_index(
        "ix_projects_tenant_id_sample",
        "projects",
        ["tenant_id"],
        unique=True,
        postgresql_where=sa.text("sample AND deleted_at IS NULL"),
    )


def downgrade() -> None:
    op.drop_index("ix_projects_tenant_id_sample", table_name="projects")
    op.drop_column("projects", "sample")
