import uuid
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

from parfocal_common.schema_sql import (
    enable_tenant_isolation,
    track_updated_at,
    untrack_updated_at,
)

revision: str = "0013"
down_revision: str | None = "0012"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "accession_formats",
        sa.Column("tenant_id", sa.Uuid[uuid.UUID](), sa.ForeignKey("tenants.id"), primary_key=True),
        sa.Column("template", sa.String(60), nullable=False),
        sa.Column("prefixes", postgresql.ARRAY(sa.String(4)), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
    )
    op.create_table(
        "accession_counters",
        sa.Column("tenant_id", sa.Uuid[uuid.UUID](), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("prefix", sa.String(4), nullable=False),
        sa.Column("year", sa.SmallInteger, nullable=False),
        sa.Column("last_value", sa.Integer, nullable=False),
        sa.PrimaryKeyConstraint("tenant_id", "prefix", "year"),
    )
    for statement in [
        *enable_tenant_isolation("accession_formats"),
        *enable_tenant_isolation("accession_counters"),
        *track_updated_at("accession_formats"),
    ]:
        op.execute(statement)


def downgrade() -> None:
    op.execute(untrack_updated_at("accession_formats")[0])
    op.drop_table("accession_counters")
    op.drop_table("accession_formats")
