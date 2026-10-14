import uuid
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

from parfocal_common.schema_sql import enable_tenant_isolation

revision: str = "0015"
down_revision: str | None = "0014"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("cases", sa.Column("service", sa.String(60), nullable=True))
    op.add_column("cases", sa.Column("requester", sa.String(200), nullable=True))
    op.add_column(
        "cases", sa.Column("is_draft", sa.Boolean, nullable=False, server_default=sa.false())
    )
    op.add_column(
        "blocks",
        sa.Column("stains", postgresql.ARRAY(sa.String(60)), nullable=False, server_default="{}"),
    )
    op.add_column(
        "blocks", sa.Column("levels", sa.SmallInteger, nullable=False, server_default="1")
    )
    op.create_check_constraint("levels", "blocks", "levels BETWEEN 1 AND 50")
    op.create_table(
        "case_requests",
        sa.Column("tenant_id", sa.Uuid[uuid.UUID](), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("user_id", sa.Uuid[uuid.UUID](), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("request_key", sa.String(100), nullable=False),
        sa.Column("case_id", sa.Uuid[uuid.UUID](), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.PrimaryKeyConstraint("tenant_id", "user_id", "request_key"),
        sa.ForeignKeyConstraint(["case_id", "tenant_id"], ["cases.id", "cases.tenant_id"]),
    )
    for statement in enable_tenant_isolation("case_requests"):
        op.execute(statement)


def downgrade() -> None:
    op.drop_table("case_requests")
    op.drop_constraint("levels", "blocks", type_="check")
    op.drop_column("blocks", "levels")
    op.drop_column("blocks", "stains")
    op.drop_column("cases", "is_draft")
    op.drop_column("cases", "requester")
    op.drop_column("cases", "service")
