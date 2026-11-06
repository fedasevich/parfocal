import uuid
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

from parfocal_common.schema_sql import enable_tenant_isolation

revision: str = "0093"
down_revision: str | None = "0092"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def ids() -> list[sa.Column[uuid.UUID]]:
    return [
        sa.Column(
            "id",
            sa.Uuid[uuid.UUID](),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "tenant_id",
            sa.Uuid[uuid.UUID](),
            sa.ForeignKey("tenants.id"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "task_id",
            sa.Uuid[uuid.UUID](),
            sa.ForeignKey("review_tasks.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
    ]


def person(name: str) -> sa.Column[uuid.UUID]:
    return sa.Column(name, sa.Uuid[uuid.UUID](), sa.ForeignKey("users.id"), nullable=True)


def upgrade() -> None:
    op.create_table(
        "evaluation_versions",
        *ids(),
        sa.Column("number", sa.Integer, nullable=False),
        sa.Column("reason", sa.String(500), nullable=True),
        person("started_by_user_id"),
        sa.Column(
            "started_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column("signed_at", sa.DateTime(timezone=True), nullable=True),
        person("signed_by_user_id"),
        sa.Column("confirmed_with", sa.String(10), nullable=True),
        sa.Column("checksum", sa.String(80), nullable=True),
        sa.Column("evaluation", JSONB, nullable=True),
        sa.Column("blocks", JSONB, nullable=True),
        sa.Column("format", JSONB, nullable=True),
        sa.UniqueConstraint("task_id", "number"),
        sa.CheckConstraint("number >= 1", name="number"),
        sa.CheckConstraint(
            "confirmed_with IS NULL OR confirmed_with IN ('sso', 'password')",
            name="confirmed_with",
        ),
        sa.CheckConstraint("(signed_at IS NULL) = (checksum IS NULL)", name="signed"),
    )
    op.create_table(
        "evaluation_changes",
        *ids(),
        sa.Column("version", sa.Integer, nullable=False),
        sa.Column("slide_id", sa.Uuid[uuid.UUID](), sa.ForeignKey("slides.id"), nullable=False),
        sa.Column("object_id", sa.String(40), nullable=False),
        sa.Column("change", sa.String(200), nullable=False),
        sa.Column("reason", sa.String(500), nullable=False),
        person("changed_by_user_id"),
        sa.Column(
            "changed_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
    )
    for table in ("evaluation_versions", "evaluation_changes"):
        for statement in enable_tenant_isolation(table):
            op.execute(statement)


def downgrade() -> None:
    op.drop_table("evaluation_changes")
    op.drop_table("evaluation_versions")
